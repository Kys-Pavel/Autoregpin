const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class ProfileManager {
    /**
     * @param {string} profilesDir - директория для хранения профилей
     */
    constructor(profilesDir) {
        this.profilesDir = path.resolve(profilesDir);
        if (!fs.existsSync(this.profilesDir)) {
            fs.mkdirSync(this.profilesDir, { recursive: true });
        }
    }

    /**
     * Получить путь к профилю по ID аккаунта
     */
    getProfilePath(accountId) {
        return path.join(this.profilesDir, `account_${accountId}`);
    }

    /**
     * Создать директорию профиля (Chrome user-data-dir будет создан автоматически)
     */
    createProfile(accountId) {
        const profilePath = this.getProfilePath(accountId);
        if (!fs.existsSync(profilePath)) {
            fs.mkdirSync(profilePath, { recursive: true });
            logger.info(`Создан профиль: ${profilePath}`);
        } else {
            logger.debug(`Профиль уже существует: ${profilePath}`);
        }
        return profilePath;
    }

    /**
     * Проверить существование профиля
     */
    profileExists(accountId) {
        return fs.existsSync(this.getProfilePath(accountId));
    }

    /**
     * Удалить профиль
     */
    deleteProfile(accountId) {
        const profilePath = this.getProfilePath(accountId);
        if (fs.existsSync(profilePath)) {
            fs.rmSync(profilePath, { recursive: true, force: true });
            logger.info(`Удалён профиль: ${profilePath}`);
            return true;
        }
        return false;
    }

    /**
     * Список всех профилей
     */
    listProfiles() {
        if (!fs.existsSync(this.profilesDir)) return [];

        return fs.readdirSync(this.profilesDir)
            .filter(name => name.startsWith('account_'))
            .map(name => {
                const profilePath = path.join(this.profilesDir, name);
                const stats = fs.statSync(profilePath);
                const accountId = parseInt(name.replace('account_', ''), 10);

                // Считаем размер директории
                let totalSize = 0;
                try {
                    totalSize = this._getDirSize(profilePath);
                } catch (e) {
                    // Игнорируем ошибки подсчёта размера
                }

                return {
                    accountId,
                    name,
                    path: profilePath,
                    createdAt: stats.birthtime,
                    modifiedAt: stats.mtime,
                    sizeMb: Math.round(totalSize / (1024 * 1024) * 100) / 100
                };
            })
            .sort((a, b) => a.accountId - b.accountId);
    }

    /**
     * Размер директории рекурсивно
     */
    _getDirSize(dirPath) {
        let total = 0;
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isFile()) {
                total += fs.statSync(fullPath).size;
            } else if (entry.isDirectory()) {
                total += this._getDirSize(fullPath);
            }
        }
        return total;
    }
}

module.exports = ProfileManager;
