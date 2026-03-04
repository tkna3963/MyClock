let BaseInfoList = [];

// ─────────────────────────────────────────
// timezone_data.json を読み込む
// ─────────────────────────────────────────
function TimeZoneData() {
    fetch('timezone_data.json')
        .then(response => response.json())
        .then(data => {
            BaseInfoList.TimeZoneData = data;
            BaseInfoList.TimeZoneInfo = {
                timeZone: BaseInfoList.TimeZone,
                ...BaseInfoList.TimeZoneData[BaseInfoList.TimeZone]
            };
            document.getElementById("CountryView").textContent =
                BaseInfoList.TimeZoneInfo.alpha3 || BaseInfoList.TimeZone;

            // ドロップダウンのリストを構築
            buildTimezoneList(data);
        })
        .catch(error => {
            console.error('Error:', error);
        });
}

// ─────────────────────────────────────────
// タイムゾーンリスト構築
// ─────────────────────────────────────────
function buildTimezoneList(data) {
    const ul = document.getElementById("TimezoneList");
    ul.innerHTML = "";

    const entries = Object.entries(data); // [[tz, info], ...]

    function renderList(filter) {
        ul.innerHTML = "";
        const filtered = filter
            ? entries.filter(([tz, info]) =>
                tz.toLowerCase().includes(filter) ||
                (info.country_en && info.country_en.toLowerCase().includes(filter)) ||
                (info.alpha3 && info.alpha3.toLowerCase().includes(filter))
            )
            : entries;

        filtered.forEach(([tz, info]) => {
            const li = document.createElement("li");
            if (tz === BaseInfoList.TimeZone) li.classList.add("selected");

            const label = document.createElement("span");
            label.textContent = info.country_en
                ? `${info.country_en}  (${tz})`
                : tz;

            const alpha = document.createElement("span");
            alpha.className = "tz-alpha3";
            alpha.textContent = info.alpha3 || "";

            li.appendChild(label);
            li.appendChild(alpha);

            li.addEventListener("click", () => {
                selectTimezone(tz, info);
                closeDropdown();
            });

            ul.appendChild(li);
        });
    }

    // 検索フィルター
    const searchInput = document.getElementById("TimezoneSearch");
    searchInput.addEventListener("input", () => {
        renderList(searchInput.value.trim().toLowerCase() || null);
    });

    renderList(null);
}

// ─────────────────────────────────────────
// タイムゾーン切り替え
// ─────────────────────────────────────────
function selectTimezone(tz, info) {
    BaseInfoList.TimeZone = tz;
    BaseInfoList.TimeZoneInfo = { timeZone: tz, ...info };
    document.getElementById("CountryView").textContent = info.alpha3 || tz;

    // リスト再描画して selected を更新
    buildTimezoneList(BaseInfoList.TimeZoneData);
}

// ─────────────────────────────────────────
// ドロップダウン開閉
// ─────────────────────────────────────────
function openDropdown() {
    const dropdown = document.getElementById("TimezoneDropdown");
    dropdown.classList.add("open");
    // 開くたびに検索欄をリセットしてフォーカス
    const searchInput = document.getElementById("TimezoneSearch");
    searchInput.value = "";
    buildTimezoneList(BaseInfoList.TimeZoneData);
    searchInput.focus();
}

function closeDropdown() {
    document.getElementById("TimezoneDropdown").classList.remove("open");
}

function toggleDropdown() {
    const dropdown = document.getElementById("TimezoneDropdown");
    if (dropdown.classList.contains("open")) {
        closeDropdown();
    } else {
        openDropdown();
    }
}

// ─────────────────────────────────────────
// デバイス現在時刻取得
// ─────────────────────────────────────────
function GetDeviceNowTime() {
    const rawNow = new Date();
    const offset = BaseInfoList.NTPNowTimeOffset || 0;
    const now = new Date(rawNow.getTime() + offset);

    // 選択中のタイムゾーンで各フィールドを取得
    const tz = BaseInfoList.TimeZone || "UTC";
    const fmt = (field, opts) =>
        new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts })
            .format(now);

    const year    = fmt("year",    { year: "numeric" });
    const month   = String(now.toLocaleString("en-US", { timeZone: tz, month: "numeric" })).padStart(2, "0");
    const day     = String(now.toLocaleString("en-US", { timeZone: tz, day: "numeric" })).padStart(2, "0");
    const hours   = String(now.toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false })).padStart(2, "0");
    const minutes = String(now.toLocaleString("en-US", { timeZone: tz, minute: "numeric" })).padStart(2, "0");
    const seconds = String(now.toLocaleString("en-US", { timeZone: tz, second: "numeric" })).padStart(2, "0");
    const mseconds = String(rawNow.getMilliseconds()).padStart(3, "0");

    BaseInfoList.DeviceNowTime = [now, year, month, day, hours, minutes, seconds, mseconds];
}

// ─────────────────────────────────────────
// NTP 時刻補正
// ─────────────────────────────────────────
function GetNTPNowTime() {
    const results = [];
    let count = 0;

    function fetchOnce() {
        const startTime = Date.now();
        fetch('https://dev.narikakun.net/webapi/ntp')
            .then(response => response.json())
            .then(data => {
                const endTime = Date.now();
                const ntpTime = new Date(data.serverTimestamp).getTime();
                const roundTrip = endTime - startTime;
                const estimatedServerTime = ntpTime + roundTrip / 2;
                const offset = estimatedServerTime - endTime;
                results.push({ offset, roundTrip });
            })
            .catch(error => {
                console.error('NTP time fetch error:', error);
            })
            .finally(() => {
                count++;
                if (count < 10) {
                    setTimeout(fetchOnce, 1000);
                } else {
                    if (results.length === 0) return;
                    results.sort((a, b) => a.roundTrip - b.roundTrip);
                    const best = results[0];
                    BaseInfoList.NTPNowTimeOffset = best.offset;
                    console.log("Best offset:", best.offset, "RoundTrip:", best.roundTrip);
                }
            });
    }

    fetchOnce();
}

// ─────────────────────────────────────────
// 時刻表示更新
// ─────────────────────────────────────────
function TimeViewChange() {
    const ms = String(BaseInfoList.DeviceNowTime[7]).padStart(3, '0').slice(0, 2);
    const TimeViewText =
        BaseInfoList.DeviceNowTime[4] + ":" +
        BaseInfoList.DeviceNowTime[5] + ":" +
        BaseInfoList.DeviceNowTime[6] + ":" +
        String(ms).padStart(2, '0');
    document.getElementById("TimeView").innerHTML = TimeViewText;
}

// ─────────────────────────────────────────
// メインループ
// ─────────────────────────────────────────
function loop() {
    setInterval(() => {
        GetDeviceNowTime();
        TimeViewChange();
    }, 10);

    setInterval(() => {
        GetNTPNowTime();
    }, 1000 * 60);
}

// ─────────────────────────────────────────
// セットアップ
// ─────────────────────────────────────────
function setup() {
    BaseInfoList.TimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    TimeZoneData();
    GetNTPNowTime();
    loop();

    // CountryView クリックでトグル
    document.getElementById("CountryView").addEventListener("click", (e) => {
        e.stopPropagation();
        toggleDropdown();
    });

    // ドロップダウン外クリックで閉じる
    document.addEventListener("click", (e) => {
        const dropdown = document.getElementById("TimezoneDropdown");
        if (!dropdown.contains(e.target)) {
            closeDropdown();
        }
    });

    // ドロップダウン内クリックは伝播を止めない（検索・リストはそのまま動く）
    document.getElementById("TimezoneDropdown").addEventListener("click", (e) => {
        e.stopPropagation();
    });
}

document.addEventListener("DOMContentLoaded", () => {
    setup();
});