(function () {
  const slopeInput = document.getElementById('slope');
  const chooseFileBtn = document.getElementById('chooseFile');
  const fileInput = document.getElementById('fileInput');
  const fileNameSpan = document.getElementById('fileName');
  const analyzeBtn = document.getElementById('analyze');
  const resultCountSpan = document.getElementById('resultCount');
  const segmentListEl = document.getElementById('segmentList');

  let selectedFile = null;

  chooseFileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      selectedFile = file;
      fileNameSpan.textContent = file.name;
      resultCountSpan.textContent = '—';
      renderSegmentList([]);
    }
  });

  analyzeBtn.addEventListener('click', runAnalysis);

  function runAnalysis() {
    const slopeThreshold = parseFloat(slopeInput.value, 10);
    if (Number.isNaN(slopeThreshold) || slopeThreshold < 0) {
      resultCountSpan.textContent = '请输入有效坡度阈值';
      return;
    }
    if (!selectedFile) {
      resultCountSpan.textContent = '请先选择文件';
      return;
    }

    resultCountSpan.textContent = '分析中…';
    const ext = (selectedFile.name || '').toLowerCase();

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/xml');
        const geojson = ext.endsWith('.kml')
          ? toGeoJSON.kml(doc)
          : toGeoJSON.gpx(doc);

        const segments = getSegmentsAboveSlope(geojson, slopeThreshold);
        resultCountSpan.textContent = String(segments.length);
        renderSegmentList(segments);
      } catch (err) {
        resultCountSpan.textContent = '解析失败';
        console.error(err);
      }
    };
    reader.onerror = () => {
      resultCountSpan.textContent = '读取文件失败';
    };
    reader.readAsText(selectedFile, 'UTF-8');
  }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  const MIN_HORIZONTAL_M = 20;   // 水平距离超过 20m 才算
  const MIN_HEIGHT_M = 10;      // 总爬升大于 10m 才算有效坡
  const MAX_FLAT_M = 10;        // 中途平路累计不超过 10m 才视为连续

  /**
   * 将轨迹切分为「连续爬升段」：海拔不降，且中途平路（水平距离）累计不超过 10m 的视为一段；
   * 直到平路超过 10m 或海拔开始下降则结束当前段。
   * 返回 [{ startIdx, endIdx }, ...]，下标均含（inclusive）。
   */
  function buildClimbChunks(coords) {
    const chunks = [];
    let startIdx = 0;
    let flatDist = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const ele1 = p1[2];
      const ele2 = p2[2];
      if (ele1 == null || ele2 == null) {
        chunks.push({ startIdx, endIdx: i });
        startIdx = i + 1;
        flatDist = 0;
        continue;
      }
      const dist = haversineMeters(p1[1], p1[0], p2[1], p2[0]);
      const deltaEle = ele2 - ele1;
      if (deltaEle < 0) {
        chunks.push({ startIdx, endIdx: i });
        startIdx = i + 1;
        flatDist = 0;
      } else if (deltaEle === 0) {
        flatDist += dist;
        if (flatDist > MAX_FLAT_M) {
          chunks.push({ startIdx, endIdx: i });
          startIdx = i + 1;
          flatDist = 0;
        }
      } else {
        flatDist = 0;
      }
    }
    if (startIdx <= coords.length - 1) {
      chunks.push({ startIdx, endIdx: coords.length - 1 });
    }
    return chunks;
  }

  function coordsFromGeoJSON(geojson) {
    const coords = [];
    function walk(obj) {
      if (!obj) return;
      if (obj.type === 'Feature') {
        walk(obj.geometry);
        return;
      }
      if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
        obj.features.forEach(walk);
        return;
      }
      if (obj.type === 'LineString' && Array.isArray(obj.coordinates)) {
        coords.push(...obj.coordinates);
        return;
      }
      if (obj.type === 'MultiLineString' && Array.isArray(obj.coordinates)) {
        obj.coordinates.forEach((line) => coords.push(...line));
      }
    }
    walk(geojson);
    return coords;
  }

  /**
   * 有效路段 = 连续爬升段（海拔不降，平路≤10m）。对每段用总爬升/总水平距离算坡度。
   * 只保留：水平距离≥20m、总爬升>10m、坡度>阈值的段。
   */
  function getSegmentsAboveSlope(geojson, threshold) {
    const coords = coordsFromGeoJSON(geojson);
    const chunks = buildClimbChunks(coords);
    const segments = [];
    for (const { startIdx, endIdx } of chunks) {
      const start = coords[startIdx];
      const end = coords[endIdx];
      const startEle = start[2];
      const endEle = end[2];
      if (startEle == null || endEle == null) continue;
      const totalGain = endEle - startEle;
      if (totalGain <= MIN_HEIGHT_M) continue;
      let totalDist = 0;
      for (let j = startIdx; j < endIdx; j++) {
        const a = coords[j];
        const b = coords[j + 1];
        totalDist += haversineMeters(a[1], a[0], b[1], b[0]);
      }
      if (totalDist < MIN_HORIZONTAL_M) continue;
      const slope = (totalGain / totalDist) * 100;
      if (slope <= threshold) continue;
      segments.push({
        start: { lon: start[0], lat: start[1], ele: startEle },
        end: { lon: end[0], lat: end[1], ele: endEle },
        slope: Math.round(slope * 10) / 10,
        distM: Math.round(totalDist * 10) / 10,
        gainM: Math.round(totalGain * 10) / 10
      });
    }
    return segments;
  }

  function renderSegmentList(segments) {
    if (!segments.length) {
      segmentListEl.innerHTML = '<p class="segment-list-empty">暂无符合条件的路段</p>';
      return;
    }
    segmentListEl.innerHTML =
      '<table><thead><tr><th>起点(经度,纬度)</th><th>起点海拔(m)</th><th>终点(经度,纬度)</th><th>终点海拔(m)</th><th>水平距离(m)</th><th>累积爬升(m)</th><th>坡度(%)</th></tr></thead><tbody>' +
      segments
        .map(
          (s) =>
            '<tr><td>' +
            s.start.lon.toFixed(6) +
            ',' +
            s.start.lat.toFixed(6) +
            '</td><td>' +
            (s.start.ele != null ? s.start.ele.toFixed(1) : '—') +
            '</td><td>' +
            s.end.lon.toFixed(6) +
            ',' +
            s.end.lat.toFixed(6) +
            '</td><td>' +
            (s.end.ele != null ? s.end.ele.toFixed(1) : '—') +
            '</td><td>' +
            s.distM +
            '</td><td>' +
            s.gainM +
            '</td><td>' +
            s.slope +
            '</td></tr>'
        )
        .join('') +
      '</tbody></table>';
  }
})();
