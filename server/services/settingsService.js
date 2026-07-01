const pool = require('../db/pool');

async function getSetting(key, fallback) {
    try {
        const r = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
        return r.rows.length ? r.rows[0].value : fallback;
    } catch (e) {
        return fallback;
    }
}

async function getSettingNum(key, fallback) {
    const v = parseFloat(await getSetting(key, fallback));
    return isNaN(v) ? fallback : v;
}

module.exports = { getSetting, getSettingNum };
