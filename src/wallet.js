// src/wallet.js — Pimlico ERC-4337 Token Paymaster (USDT gas on ETH mainnet)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createPublicClient, http, fallback, parseUnits, formatUnits, encodeFunctionData, parseAbi, getAddress, formatEther } = require('viem');
const { privateKeyToAccount, generatePrivateKey } = require('viem/accounts');
const { mainnet } = require('viem/chains');
const { entryPoint07Address } = require('viem/account-abstraction');
const { createSmartAccountClient } = require('permissionless');
const { toSafeSmartAccount } = require('permissionless/accounts');
const { createPimlicoClient } = require('permissionless/clients/pimlico');
const { prepareUserOperationForErc20Paymaster } = require('permissionless/experimental/pimlico');

const USDT_ETH = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const PIMLICO_URL = `https://api.pimlico.io/v2/1/rpc?apikey=${process.env.PIMLICO_API_KEY}`;

// Надёжные публичные ETH RPC (с fallback)
const PUBLIC_RPC_URLS = [
    'https://eth.llamarpc.com',
    'https://ethereum.publicnode.com',
    'https://rpc.ankr.com/eth',
];

const ERC20_ABI = parseAbi([
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address account) view returns (uint256)',
]);

function getPublicClient() {
    return createPublicClient({ 
        chain: mainnet, 
        transport: fallback(PUBLIC_RPC_URLS.map(url => http(url))) 
    });
}

function getPimlicoClient() {
    return createPimlicoClient({
        chain: mainnet,
        transport: http(PIMLICO_URL),
        entryPoint: { address: entryPoint07Address, version: '0.7' },
    });
}

// ─── Получить Safe Smart Account адрес из приватного ключа ──────────────────
async function getSafeAddress(privateKey) {
    const pk = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const owner = privateKeyToAccount(pk);
    const publicClient = getPublicClient();

    const safeAccount = await toSafeSmartAccount({
        client: publicClient,
        owners: [owner],
        entryPoint: { address: entryPoint07Address, version: '0.7' },
        version: '1.4.1',
    });

    return {
        safeAddress: safeAccount.address,
        eoaAddress: owner.address,
    };
}

// ─── Баланс USDT (бесшовный fallback через viem) ────────────────────────────
async function getUsdtBalance(address) {
    try {
        const publicClient = getPublicClient();
        const balance = await publicClient.readContract({
            address: USDT_ETH,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [getAddress(address)],
        });
        return formatUnits(balance, 6);
    } catch (e) {
        // Если даже fallback() не справился, используем нативный HTTPS
        return await getUsdtBalanceNative(address);
    }
}

// Нативный HTTPS fallback без viem
function getUsdtBalanceNative(address) {
    return new Promise((resolve, reject) => {
        const https = require('https');
        const data = '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0');
        const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: USDT_ETH, data }, 'latest'] });
        const req = https.request(
            { hostname: 'ethereum.publicnode.com', path: '/', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
            res => { let d = ''; res.on('data', c => d += c); res.on('end', () => {
                const json = JSON.parse(d);
                if (json.error) return reject(new Error(json.error.message));
                resolve(String(Number(BigInt(json.result)) / 1e6));
            }); }
        );
        req.on('error', reject); req.write(body); req.end();
    });
}

// ─── Создать новый кошелек ───────────────────────────────────────────────────
async function createNewWallet() {
    const newPrivateKey = generatePrivateKey();
    const { safeAddress, eoaAddress } = await getSafeAddress(newPrivateKey);

    return {
        privateKey: newPrivateKey,
        eoaAddress,
        safeAddress,
    };
}

// ─── Отправить USDT через Pimlico Paymaster (газ в USDT) ───────────────────
async function sendUsdt(privateKey, toAddress, amountUsdt) {
    const pk = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const owner = privateKeyToAccount(pk);
    const publicClient = getPublicClient();
    const pimlicoClient = getPimlicoClient();

    const safeAccount = await toSafeSmartAccount({
        client: publicClient,
        owners: [owner],
        entryPoint: { address: entryPoint07Address, version: '0.7' },
        version: '1.4.1',
    });

    const smartAccountClient = createSmartAccountClient({
        account: safeAccount,
        chain: mainnet,
        bundlerTransport: http(PIMLICO_URL),
        paymaster: pimlicoClient,
        userOperation: {
            estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
            prepareUserOperation: prepareUserOperationForErc20Paymaster(pimlicoClient),
        },
    });

    const amountRaw = parseUnits(amountUsdt.toString(), 6);
    const transferData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [getAddress(toAddress), amountRaw],
    });

    // Отправляем через bundler
    const txHash = await smartAccountClient.sendTransaction({
        calls: [{ to: USDT_ETH, data: transferData, value: 0n }],
    });

    // Ждём подтверждения
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    // Стоимость газа
    const gasCostWei = receipt.gasUsed * receipt.effectiveGasPrice;
    const gasCostEth = parseFloat(formatEther(gasCostWei));
    const gasCostUsd = (gasCostEth * 2200).toFixed(4); // approx

    return {
        hash: txHash,
        blockNumber: receipt.blockNumber.toString(),
        status: receipt.status,
        gasUsed: receipt.gasUsed.toString(),
        gasCostUsd,
    };
}

module.exports = {
    createNewWallet,
    getUsdtBalance,
    sendUsdt,
    getSafeAddress,
};
