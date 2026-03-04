/**
 * globe.js
 * D3.js + TopoJSON による回転地球儀モジュール
 * 視点: 国際宇宙ステーション（ISS）軌道上
 *
 * ISS軌道パラメータ（実測値準拠）
 *   軌道傾斜角  : 51.6°（赤道に対する軌道面の傾き）
 *   高度        : 約420km（地球半径の約6.6%上空）
 *   公転周期    : 約92分（地球1周）
 *   地球自転    : ISSが1周する間に約23°西へずれる
 *
 * 本実装での近似
 *   - 視点仰角      : ISS軌道傾斜角 51.6° をカメラの緯度オフセットに適用
 *   - 軌道ロール    : ISS進行方向に合わせてZ軸を +51.6° 傾ける
 *   - 地球自転ずれ  : 軌道1周ごとに経度を ORBIT_LONGITUDE_DRIFT だけ西にシフト
 *
 * 依存: d3 (v5+), topojson-client
 * 使用: <svg id="globe"></svg> を配置後に init() を呼ぶ
 */

"use strict";

const Globe = (() => {

    // ─────────────────────────────────────────
    // 定数
    // ─────────────────────────────────────────
    const CONFIG = Object.freeze({
        SCALE_DIVISOR: 2.5,        // scale = windowHeight / SCALE_DIVISOR
        CLIP_BACK: 180,        // 裏面クリップ角
        CLIP_FRONT: 90,         // 表面クリップ角

        // ── ISS 軌道パラメータ ──────────────────────────────
        // ISSは赤道に対して51.6°傾いた軌道を飛行する。
        // geoOrthographic の rotate([λ, φ, γ]) は
        //   λ: 経度回転（東西） → アニメーションで増加
        //   φ: 緯度オフセット  → カメラの「見下ろし緯度」
        //   γ: ロール角        → 軌道傾斜をカメラの傾きで表現
        //
        // ISSの軌道傾斜51.6°を φ と γ に分解:
        //   φ = -51.6  地球を約51.6°南から見上げる仰角
        //   γ = +51.6  軌道面に沿ってカメラをロール
        ISS_ORBIT_INCLINATION: 51.6,  // ISS軌道傾斜角（度）
        ISS_VIEW_LATITUDE: -51.6,  // 視点緯度オフセット（φ）
        ISS_ORBITAL_ROLL: 51.6,  // 軌道ロール角（γ）

        // ISS公転周期 92分 → 地球は自転で約23°ずれる
        // 1フレーム(60ms)あたりのずれ: 23° / (92*60*1000/60) ≈ 0.00025°
        // 視覚的にわかるよう ROTATION_SPEED と合算して管理
        ORBIT_LONGITUDE_DRIFT: 0.0003, // フレームあたりの自転ずれ量（度）
        // ─────────────────────────────────────────────────────

        ROTATION_SPEED: 0.3,        // フレームあたりの軌道周回速度（度）
        INTERVAL_MS: 60,         // アニメーション間隔（ms）
        COLOR_BACK: "#EDE9F1",  // 裏面の塗りつぶし色（地球の裏側）
        COLOR_FRONT: "#FD81DB",  // 表面の塗りつぶし色（手前の陸地）
        GEO_JSON_PATH: "110m.json",
        SVG_SELECTOR: "svg",
    });

    // ─────────────────────────────────────────
    // 内部状態
    // ─────────────────────────────────────────
    let state = {
        stage: null,
        projection180: null,
        projection90: null,
        backPath: null,
        frontPath: null,
        geojson: null,    // フェッチ済みデータをキャッシュ
        rotateTimer: null,
        issLongitude: 0,       // ISS現在経度（軌道周回アニメーション）
        driftOffset: 0,       // 地球自転によるISS軌跡のずれ累積
        isRunning: false,
    };

    // ─────────────────────────────────────────
    // プロジェクション生成
    // ─────────────────────────────────────────
    // ISS視点プロジェクション生成
    // rotate([λ, φ, γ]):
    //   λ = issLongitude        軌道周回による経度変化
    //   φ = ISS_VIEW_LATITUDE   軌道傾斜角に対応した緯度オフセット (-51.6°)
    //   γ = ISS_ORBITAL_ROLL    軌道面傾斜をカメラロールで表現  (+51.6°)
    function createProjection(height) {
        return d3.geoOrthographic()
            .scale(height / CONFIG.SCALE_DIVISOR)
            .rotate([0, CONFIG.ISS_VIEW_LATITUDE, CONFIG.ISS_ORBITAL_ROLL])
            .translate([height / 2, height / 2]);
    }

    // ─────────────────────────────────────────
    // パス更新
    // ─────────────────────────────────────────
    function updatePaths() {
        state.stage.selectAll("path")
            .attr("d", (d, i) => i === 0
                ? state.backPath(d)
                : state.frontPath(d)
            );
    }

    // ─────────────────────────────────────────
    // SVG・プロジェクション再構築
    // ─────────────────────────────────────────
    function rebuildProjections(height) {
        state.stage
            .attr("width", height)
            .attr("height", height);

        state.projection180 = createProjection(height).clipAngle(CONFIG.CLIP_BACK);
        state.projection90 = createProjection(height).clipAngle(CONFIG.CLIP_FRONT);
        state.backPath = d3.geoPath().projection(state.projection180);
        state.frontPath = d3.geoPath().projection(state.projection90);
    }

    // ─────────────────────────────────────────
    // パス要素の描画
    // ─────────────────────────────────────────
    function renderPaths(geojson) {
        const collection = { type: "FeatureCollection", features: geojson };

        state.stage.selectAll("path").remove();

        // 裏面（index 0）
        state.stage.append("path")
            .datum(collection)
            .attr("d", state.backPath)
            .attr("fill", CONFIG.COLOR_BACK)
            .attr("stroke", "none");

        // 表面（index 1）
        state.stage.append("path")
            .datum(collection)
            .attr("d", state.frontPath)
            .attr("fill", CONFIG.COLOR_FRONT)
            .attr("stroke", "none");
    }

    // ─────────────────────────────────────────
    // アニメーション制御
    // ─────────────────────────────────────────
    function startRotation() {
        stopRotation();
        state.isRunning = true;

        state.rotateTimer = setInterval(() => {
            // ISS軌道周回: 経度を進める
            state.issLongitude = (state.issLongitude + CONFIG.ROTATION_SPEED) % 360;

            // 地球自転ずれ: ISSが周回するほど地上の軌跡は西にずれる
            state.driftOffset = (state.driftOffset + CONFIG.ORBIT_LONGITUDE_DRIFT) % 360;

            // λ = 軌道経度 + 自転ずれ
            const lambda = state.issLongitude + state.driftOffset;

            state.projection180.rotate([lambda, CONFIG.ISS_VIEW_LATITUDE, CONFIG.ISS_ORBITAL_ROLL]);
            state.projection90.rotate([lambda, CONFIG.ISS_VIEW_LATITUDE, CONFIG.ISS_ORBITAL_ROLL]);

            updatePaths();
        }, CONFIG.INTERVAL_MS);
    }

    function stopRotation() {
        if (state.rotateTimer !== null) {
            clearInterval(state.rotateTimer);
            state.rotateTimer = null;
        }
        state.isRunning = false;
    }

    // ─────────────────────────────────────────
    // GeoJSON 取得（キャッシュ付き）
    // ─────────────────────────────────────────
    async function fetchGeoJson() {
        if (state.geojson) return state.geojson;

        const json = await d3.json(CONFIG.GEO_JSON_PATH);
        state.geojson = topojson.feature(json, json.objects.countries).features;
        return state.geojson;
    }

    // ─────────────────────────────────────────
    // リサイズハンドラ（デバウンス付き）
    // ─────────────────────────────────────────
    let resizeDebounce = null;

    function onResize() {
        clearTimeout(resizeDebounce);
        resizeDebounce = setTimeout(async () => {
            try {
                const height = window.innerHeight;
                const geojson = await fetchGeoJson();

                rebuildProjections(height);
                renderPaths(geojson);
                startRotation();
            } catch (err) {
                console.error("[Globe] リサイズ処理中にエラーが発生しました:", err);
            }
        }, 150); // 150ms デバウンス
    }

    // ─────────────────────────────────────────
    // 公開 API
    // ─────────────────────────────────────────

    /**
     * 地球儀を初期化して描画を開始する
     * @param {string} [selector] - SVG セレクタ（省略時は CONFIG.SVG_SELECTOR）
     */
    async function init(selector = CONFIG.SVG_SELECTOR) {
        try {
            state.stage = d3.select(selector);

            if (state.stage.empty()) {
                throw new Error(`SVG 要素が見つかりません: "${selector}"`);
            }

            const height = window.innerHeight;
            const geojson = await fetchGeoJson();

            rebuildProjections(height);
            renderPaths(geojson);
            startRotation();

            window.addEventListener("resize", onResize);
        } catch (err) {
            console.error("[Globe] 初期化に失敗しました:", err);
        }
    }

    /** アニメーションを一時停止する */
    function pause() {
        stopRotation();
    }

    /** 一時停止したアニメーションを再開する */
    function resume() {
        if (!state.isRunning) startRotation();
    }

    /** リソースを解放してイベントリスナーを削除する */
    function destroy() {
        stopRotation();
        window.removeEventListener("resize", onResize);
        if (state.stage) state.stage.selectAll("path").remove();
        state = { ...state, stage: null, geojson: null };
    }

    return { init, pause, resume, destroy };

})();

// ─────────────────────────────────────────
// エントリーポイント
// ─────────────────────────────────────────
Globe.init();