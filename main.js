(function () {
  const slopeInput = document.getElementById('slope');
  const chooseFileBtn = document.getElementById('chooseFile');
  const fileInput = document.getElementById('fileInput');
  const fileNameSpan = document.getElementById('fileName');
  const analyzeBtn = document.getElementById('analyze');
  const resultCountSpan = document.getElementById('resultCount');

  let selectedFile = null;

  chooseFileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      selectedFile = file;
      fileNameSpan.textContent = file.name;
      resultCountSpan.textContent = '—';
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

        const count = countSegmentsAboveSlope(geojson, slopeThreshold);
        resultCountSpan.textContent = String(count);
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

  /**
   * 坡度（百分比）= (高程差 / 水平距离) × 100
   * 水平距离用 Haversine 球面距离（米），高程单位需为米（GPX 标准）。
   * 返回绝对值，便于同时统计陡上坡和陡下坡。
   * 水平距离过短时返回 NaN，调用方应忽略该段（避免 GPS 噪声放大）。
   */
  function getSlopePercent(p1, p2) {
    const ele1 = p1[2];
    const ele2 = p2[2];
    if (ele1 == null || ele2 == null) return NaN; // 无高程数据
    const lon1 = p1[0], lat1 = p1[1];
    const lon2 = p2[0], lat2 = p2[1];
    const dist = haversineMeters(lat1, lon1, lat2, lon2);
    const minDistM = 4; // 水平距离超过 20m 才算，否则不参与统计
    if (dist < minDistM) return NaN;
    const deltaEle = ele2 - ele1;
    const slopePercent = (deltaEle / dist) * 100;
    return Math.abs(slopePercent);
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

  function countSegmentsAboveSlope(geojson, threshold) {
    const coords = coordsFromGeoJSON(geojson);
    let count = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const slope = getSlopePercent(coords[i], coords[i + 1]);
      if (!Number.isNaN(slope) && slope > threshold) count++;
    }
    return count;
  }
})();
