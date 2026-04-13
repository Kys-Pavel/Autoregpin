# Repair Log

## 2026-04-06

### Step 1. Initial diagnosis
- Reviewed project structure, `config.json`, `data/accounts.json`, and recent logs.
- Confirmed the main blocker is proxy handling during launch, especially for locale-specific single-proxy configs.
- Confirmed the latest working flow reached registration, deposit, and withdrawal on account `#155`, but mass runs later failed in proxy setup and unstable launch paths.

### Step 2. First recovery target
- Chosen recovery target: restore predictable proxy selection for both explicit proxy lists and generated port ranges.
- Reason: current code assumes port arithmetic even when config provides one ready-to-use proxy URL, which produces invalid or non-existent endpoints.

### Step 3. Applied code changes
- Updated `src/proxy.js` to distinguish between:
  - generated proxy ranges from `baseString + startPort/endPort`;
  - explicit proxy URLs already listed in config.
- For explicit proxy URLs, proxy selection now uses the configured URL as-is instead of synthesizing a new port from the first entry.
- Updated `src/registrator.js` to initialize `ProxyManager` per account locale (`account.locale` / `account.country`) instead of always using a single global pool.
- Added a basic repair journal in-repo for traceability.

### Step 4. Validation in progress
- Verified syntax loading with:
  - `node -e "require('./src/proxy'); require('./src/registrator'); console.log('syntax-ok')"`
- Result: `syntax-ok`

### Step 5. Smoke checks executed
- Ran proxy smoke-check:
  - `node -e "const config=require('./config.json'); const ProxyManager=require('./src/proxy'); const pm=new ProxyManager(config.proxy,'UA'); ..."`
- Result:
  - `#156 -> socks5://MPe5oDO5BeChr88r:dXSV9bR18n7NC622@geo.g-w.info:10800`
  - `#157 -> socks5://MPe5oDO5BeChr88r:dXSV9bR18n7NC622@geo.g-w.info:10800`
- Conclusion:
  - proxy manager no longer invents invalid UA ports like `10957/10958/...` for a single explicit proxy entry.

### Step 6. Project run checks
- Ran:
  - `node src/index.js status`
  - `node demo-test.js`
- Results:
  - CLI status command works.
  - Full diagnostics completed successfully enough to confirm:
    - config loads;
    - core modules load;
    - mirrors answer HTTP 200;
    - OpenRouter/Gemini endpoint responds;
    - Pimlico endpoint responds;
    - betting API responds.
- Remaining blocker before a full live cycle:
  - no wallet currently has the required `2+ USDT` for deposit.

### Step 7. Side effects and follow-up
- `demo-test.js` generated one extra pending account in `data/accounts.json` during diagnostics (`loginId: talonvla69`, id `158`).
- Attempted to remove it automatically, but `accounts.json` was locked by another process at the time of cleanup.
- Follow-up item:
  - make `demo-test.js` fully read-only so diagnostics do not mutate working data.

## 2026-04-09

### Step 8. UA proxy updated
- Replaced the UA proxy in `config.json` with the provided SOAX proxy:
  - `socks5://7YrRs6MSTQmdP0EX:wifi;ua;;;@proxy.soax.com:37878`

### Step 9. Demo test run, step by step
- Ran `node demo-test.js`
- Result summary:
  - Step 1. Config: passed
  - Step 2. Dependencies: passed, warning only for missing `axios`
  - Step 3. Module loading: passed
  - Step 4. Wallets: passed with warnings, 1 wallet ready
  - Step 5. Account generation: passed
  - Step 6. Proxy: passed, UA proxy resolved to `proxy.soax.com:37878`
  - Step 7. OpenRouter / Gemini API: passed
  - Step 8. Pimlico API: passed
  - Step 9. Mirrors: passed, 4/4 available
  - Step 10. Betting API: passed
  - Step 11. File structure: passed
  - Step 12. Bet calculation dry-run: passed

### Step 10. Data safety check after demo run
- Checked `data/accounts.json` count before and after demo run.
- Result:
  - before: `144`
  - after: `144`
- Conclusion:
  - the new demo run did not leave an extra generated account in the file.

### Step 11. Remaining follow-up
- `demo-test.js` still prints one misplaced restore warning in Step 1:
  - `accountsBackup is not defined`
- This did not break the run and did not mutate `accounts.json` in the latest pass, but the cleanup code still needs one small follow-up fix to move the restore logic into the correct function scope.

### Step 12. Betting odds format fix
- Investigated the repeated surebet placement failures during Pinnacle matching.
- Confirmed the UI can show Hong Kong-style odds on Pinnacle, while the surebet API feed is compared in decimal format.
- Updated [src/betplacer.js](C:\Project\autoregPinn\src\betplacer.js) so displayed Pinnacle odds are matched against decimal API odds using adaptive normalization:
  - compare raw displayed value as decimal;
  - compare displayed value plus `1` as Hong Kong-to-decimal;
  - pick the closer candidate for matching.
- This specifically fixes cases like:
  - UI `0.980` vs API `1.980`
  - UI `0.769` vs API `1.769`
  - UI `13.640` vs API `14.640`

### Step 13. Anti-loop protection for repeated placement failures
- Updated [src/betplacer.js](C:\Project\autoregPinn\src\betplacer.js) to stop hammering the same failed leg indefinitely.
- Reduced retry ceiling for the second leg from `150` attempts to `12`.
- Added repeated-failure guards:
  - if `odds_not_found` repeats 3 times for the same leg, abort that leg;
  - if the same submit rejection repeats 3 times, abort that leg.
- Added richer click logs to show:
  - normalized decimal odds used for matching;
  - raw displayed odds from Pinnacle;
  - detected format (`decimal` or `hongkong`);
  - distance from expected API odds.

### Step 14. Demo diagnostics cleanup fixed
- Fixed [demo-test.js](C:\Project\autoregPinn\demo-test.js) restore logic:
  - removed the misplaced restore `finally` block from config validation;
  - moved file restoration into the account-generation test where the mutation actually happens.
- Re-ran `node demo-test.js`.
- Result:
  - the previous `accountsBackup is not defined` warning is gone;
  - diagnostics still pass at the code/config/network level;
  - the only current critical blocker is wallet balance.

### Step 15. Current live-run blocker
- Rechecked balances during diagnostics.
- Current result:
  - no wallet has the required `2 USDT` minimum for the configured deposit amount;
  - wallet `0x09670E62bF0b2fcB0ca613A061124F39EBa7FE34` now has about `0.8301 USDT`, so it is no longer ready for another live deposit cycle.
- Conclusion:
  - the registration / betting matcher bug is patched;
  - a new visible live run is currently blocked by insufficient funds, not by the old infinite surebet loop.

### Step 16. Continue script made reusable for existing accounts
- Updated [continue.js](C:\Project\autoregPinn\continue.js) so it can resume a specific account from CLI arguments instead of the old hardcoded `saintblindneo44`.
- Added a `--bet-only` mode for continuation runs:
  - no extra deposit;
  - no auto-withdrawal;
  - only login, balance check, surebet fetch, and attempt to place bets.
- Intended resume command:
  - `node continue.js Woob72 --bet-only`

### Step 17. Found another root cause in Pinnacle button detection
- Investigated why the bot still sometimes “does not even try to click the coupon”.
- Confirmed an additional DOM-matching bug in [src/betplacer.js](C:\Project\autoregPinn\src\betplacer.js):
  - buttons containing `u` / `o` for totals were being filtered out before matching;
  - the matcher only understood `HOME / AWAY / DRAW`, but not `OVER / UNDER`;
  - the candidate search was not constrained by the target `handicap` line, so it could inspect the wrong neighboring market.

### Step 18. Totals/handicap matching fix
- Updated [src/betplacer.js](C:\Project\autoregPinn\src\betplacer.js) to improve clickable selection:
  - allow Pinnacle buttons whose text contains `u` / `o` along with the odds;
  - support side matching for `OVER` and `UNDER`;
  - filter candidate buttons by target `handicap` / total line before choosing the closest odds;
  - pass `betType` and `handicap` into the DOM matcher so selection is tied to the intended market.
- This should address cases where the bot never clicks anything on OU markets even though the betslip itself can open manually.

### Step 19. Added diagnostic dump and identified HDP sign mismatch
- User provided a live log showing:
  - match was found;
  - session was active;
  - but `diag [AWAY] candidates=0, sideCandidates=0, sample=[]`.
- Conclusion:
  - the matcher was filtering out every candidate before click selection.
- Root cause identified:
  - for `HDP` markets the API may provide `-0.5`, while Pinnacle table displays just `0.5` without the sign.
- Updated [src/betplacer.js](C:\Project\autoregPinn\src\betplacer.js):
  - `handicapMatches()` now treats `-0.5`, `+0.5`, and `0.5` as equivalent for `HDP`.
- Expected result for the next run:
  - `candidates` should become non-zero on HDP markets;
  - if not, the next fallback path is to use internal Pinnacle request payloads captured in [captured_bet.json](C:\Project\autoregPinn\captured_bet.json) instead of DOM-only matching.

### Step 20. Request-flow no longer depends on finding the DOM element first
- User provided a new live log showing an `OU` market with exact `oddsId` values already present in the surebet payload, but the run still stopped at:
  - `exact oddsId не найден в DOM`
  - `exact oddsId path failed`
- Root cause:
  - the code path was still effectively blocked by the failed exact DOM lookup before the direct Pinnacle request flow could complete;
  - in practice this meant the run could terminate on `exact_odds_id_not_found` without reaching the internal `all-odds-selections -> buyV4` path in the intended way.
- Updated [src/betplacer.js](C:\Project\autoregPinn\src\betplacer.js):
  - direct request-flow is now executed whenever `exactOddsId` exists, even if the exact DOM element is absent or invisible;
  - success handling for the request path no longer assumes a DOM click result exists;
  - the remaining DOM-based row search stays disabled for strict `oddsId` runs.
- Validation:
  - `node -e "require('./src/betplacer'); console.log('betplacer-ok')"` returns `betplacer-ok`.
- What the next live run must show:
  - `📡 open-betslip by request [...]`
  - optionally `📡 selection resolved [...]`
  - optionally `📡 buyV4 [...]`
- If these log lines do not appear, the process is not running the updated code path.

### Step 21. Added constructed selectionId to the direct open-betslip request
- User provided a new live log showing the request path was finally reached, but Pinnacle returned:
  - `open-betslip by request [AWAY]: 400 FAIL`
- Investigation of [all_posts.log](C:\Project\autoregPinn\all_posts.log) and [tmp/captured-requests](C:\Project\autoregPinn\tmp\captured-requests) showed the missing field:
  - `member-betslip/v2/all-odds-selections` is not sent with just `oddsId`;
  - the live site sends a `selectionId` in the same request body.
- Current surebet API already provides `lineId`, so [src/betplacer.js](C:\Project\autoregPinn\src\betplacer.js) now builds:
  - `selectionId = lineId + "|" + oddsId + "|" + suffix`
- For the currently targeted live `HDP` / `OU` markets the suffix is derived from the market subtype encoded inside `oddsId`.
- Validation:
  - `node -e "require('./src/betplacer'); console.log('betplacer-ok')"` returns `betplacer-ok`.
- New expected log lines on the next run:
  - `📡 open selectionId [...]`
  - `📡 open-betslip by request [...]`
  - then either `📡 selection resolved [...]` / `📡 buyV4 [...]` or a different server response body.

### Step 22. Prefer captured selectionId over API-derived lineId for live markets
- User provided another live log where:
  - the constructed `selectionId` was present in logs;
  - but `all-odds-selections` still returned HTTP 400.
- Local investigation found the exact mismatch:
  - the current surebet API returned one `lineId`;
  - but [all_posts.log](C:\Project\autoregPinn\all_posts.log) already contained recent successful `selectionId` values for the same `oddsId`, using a different live `lineId`.
- Conclusion:
  - for volatile live HDP/OU markets, API `lineId` can drift from the exact `selectionId` Pinnacle expects at request time.
- Updated [src/betplacer.js](C:\Project\autoregPinn\src\betplacer.js):
  - it now loads a local `oddsId -> selectionId` hint map from [all_posts.log](C:\Project\autoregPinn\all_posts.log) and [tmp/captured-requests](C:\Project\autoregPinn\tmp\captured-requests);
  - when a hint exists, it is used instead of reconstructing `selectionId` from the current API `lineId`.
- Validation:
  - `node -e "const bp=require('./src/betplacer'); console.log('betplacer-ok')"` returns `betplacer-ok`.

### Step 23. Reworked betslip root detection for the real UI submit step
- User provided fresh live logs showing:
  - `open-betslip by request [...]` already returns `200 OK`;
  - but the actual UI submit still reports `stakeInput=false clickedPlace=false`;
  - therefore the betslip request path is alive, but the left betslip panel is still not being targeted reliably for stake entry and `Place bet`.
- Updated [src/betplacer.js](C:\Project\autoregPinn\src\betplacer.js):
  - the UI submit step no longer relies on a single narrow betslip selector;
  - it now scores visible containers containing `bet slip`, `stake`, `place bet`, or `total stake` and chooses the most plausible betslip root;
  - stake input detection now also scans broader input variants (`type="tel"`, `type="number"`, `type="text"`, partial placeholder matches);
  - `ui-submit` logs now include:
    - `stakeCandidates`
    - `placeCandidates`
    - the selected `rootTag` / `rootClass`
- Goal of this step:
  - make the next live run show exactly whether the issue is still a wrong sidebar root, zero visible stake inputs, or zero active place buttons.
- Validation:
  - `node -e "require('./src/betplacer'); console.log('betplacer-ok')"` returns `betplacer-ok`.
