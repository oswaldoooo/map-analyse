(function () {
  const levelMap = { C: 19, B: 26, A: 36, S: 45 };
  const levelOrder = ['S', 'A', 'B', 'C'];

  function getSlopeLevel(slope) {
    for (const grade of levelOrder) {
      if (slope >= levelMap[grade]) return grade;
    }
    return '—';
  }

  const slopeInput = document.getElementById('slope');
  const chooseFileBtn = document.getElementById('chooseFile');
  const fileInput = document.getElementById('fileInput');
  const fileNameSpan = document.getElementById('fileName');
  const analyzeBtn = document.getElementById('analyze');
  const autoAnalyzeBtn = document.getElementById('autoAnalyzeBtn');
  const resultCountSpan = document.getElementById('resultCount');
  const summaryContent = document.getElementById('summaryContent');
  const summaryByGrade = document.getElementById('summaryByGrade');
  const segmentListEl = document.getElementById('segmentList');
  const exportGpxBtn = document.getElementById('exportGpxBtn');
  const exportKmlBtn = document.getElementById('exportKmlBtn');
  const exportMergeKmlBtn = document.getElementById('exportMergeKmlBtn');
  const coordFormatSelect = document.getElementById('coordFormat');

  let selectedFile = null;
  let lastSegments = [];
  let lastTrackCoords = [];

  chooseFileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      selectedFile = file;
      fileNameSpan.textContent = file.name;
      resultCountSpan.textContent = '—';
      summaryByGrade.hidden = true;
      summaryContent.hidden = false;
      renderSegmentList([]);
    }
  });
  coordFormatSelect.addEventListener('change', () => {
    if (lastSegments.length) renderSegmentList(lastSegments);
  });

  analyzeBtn.addEventListener('click', () => runAnalysis(false));
  autoAnalyzeBtn.addEventListener('click', () => runAnalysis(true));
  exportGpxBtn.addEventListener('click', () => exportAs('gpx'));
  exportKmlBtn.addEventListener('click', () => exportAs('kml'));
  exportMergeKmlBtn.addEventListener('click', exportMergeKml);

  const AUTO_ANALYZE_THRESHOLD = 19;

  function runAnalysis(autoMode) {
    const slopeThreshold = autoMode ? AUTO_ANALYZE_THRESHOLD : parseFloat(slopeInput.value, 10);
    if (!autoMode && (Number.isNaN(slopeThreshold) || slopeThreshold < 0)) {
      resultCountSpan.textContent = '请输入有效坡度阈值';
      return;
    }
    if (!selectedFile) {
      resultCountSpan.textContent = '请先选择文件';
      return;
    }

    resultCountSpan.textContent = '分析中…';
    summaryByGrade.hidden = true;
    summaryContent.hidden = false;
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
        lastSegments = segments;
        lastTrackCoords = coordsFromGeoJSON(geojson);
        if (autoMode) {
          renderSummaryByGrade(segments);
          summaryContent.hidden = true;
          summaryByGrade.hidden = false;
        } else {
          resultCountSpan.textContent = String(segments.length);
        }
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

  function renderSummaryByGrade(segments) {
    const stats = { C: { count: 0, gain: 0 }, B: { count: 0, gain: 0 }, A: { count: 0, gain: 0 }, S: { count: 0, gain: 0 } };
    for (const s of segments) {
      const grade = getSlopeLevel(s.slope);
      if (grade !== '—' && stats[grade] != null) {
        stats[grade].count += 1;
        stats[grade].gain += s.gainM;
      }
    }
    summaryByGrade.innerHTML = levelOrder
      .map(
        (grade) =>
          '<div class="grade-line">' +
          grade +
          '档: ' +
          stats[grade].count +
          ' 段, 累积爬升 ' +
          Math.round(stats[grade].gain * 10) / 10 +
          ' m</div>'
      )
      .join('');
  }

  function defaultExportFilename(ext) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return (
      now.getFullYear() +
      '-' +
      pad(now.getMonth() + 1) +
      '-' +
      pad(now.getDate()) +
      '-' +
      pad(now.getHours()) +
      '-' +
      pad(now.getMinutes()) +
      '-' +
      pad(now.getSeconds()) +
      '.' +
      ext
    );
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportAs(format) {
    if (!lastSegments.length) return;
    const filename = defaultExportFilename(format === 'kml' ? 'kml' : 'gpx');
    if (format === 'kml') {
      const placemarks = lastSegments
        .map((s, i) => {
          const grade = getSlopeLevel(s.slope);
          const coordsStr = segmentPointsToKmlCoords(s.points);
          return (
            '  <Placemark><name>路段' +
            (i + 1) +
            ' (' +
            grade +
            ')</name><LineString><coordinates>' +
            coordsStr +
            '</coordinates></LineString></Placemark>'
          );
        })
        .join('\n');
      const kml =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<kml xmlns="http://www.opengis.net/kml/2.2">\n' +
        '  <Document><name>导出路段</name>\n' +
        placemarks +
        '\n  </Document>\n</kml>';
      const blob = new Blob(['\uFEFF' + kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
      downloadBlob(blob, filename);
    } else {
      const trkSegs = lastSegments
        .map((s) => {
          const grade = getSlopeLevel(s.slope);
          return (
            '  <trkseg>\n' +
            segmentPointsToGpxTrkpt(s.points) +
            '\n    <extensions><grade>' +
            grade +
            '</grade></extensions>\n  </trkseg>'
          );
        })
        .join('\n');
      const gpx =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<gpx version="1.1" creator="hikemap">\n' +
        '  <trk>\n' +
        '    <name>导出路段</name>\n' +
        trkSegs +
        '\n  </trk>\n' +
        '</gpx>';
      const blob = new Blob(['\uFEFF' + gpx], { type: 'application/gpx+xml;charset=utf-8' });
      downloadBlob(blob, filename);
    }
  }

  function exportMergeKml() {
    if (!lastSegments.length || !lastTrackCoords.length) return;
    const filename = defaultExportFilename('kml');
    const trackCoordsStr = lastTrackCoords
      .map((p) => p[0] + ',' + p[1] + (p[2] != null ? ',' + p[2] : ''))
      .join(' ');
    const styles =
      '<Style id="styleTrack"><LineStyle><color>7f7f7f7f</color><width>2</width></LineStyle></Style>\n' +
      '  <Style id="styleC"><LineStyle><color>ff00ff00</color><width>4</width></LineStyle></Style>\n' +
      '  <Style id="styleB"><LineStyle><color>ff00a5ff</color><width>4</width></LineStyle></Style>\n' +
      '  <Style id="styleA"><LineStyle><color>ff0000ff</color><width>4</width></LineStyle></Style>\n' +
      '  <Style id="styleS"><LineStyle><color>ffff00ff</color><width>4</width></LineStyle></Style>';
    const trackPlacemark =
      '<Placemark><name>原始路迹</name><styleUrl>#styleTrack</styleUrl><LineString><coordinates>' +
      trackCoordsStr +
      '</coordinates></LineString></Placemark>';
    const countByGrade = { S: 0, A: 0, B: 0, C: 0 };
    lastSegments.forEach((s) => {
      const g = getSlopeLevel(s.slope);
      if (g !== '—' && countByGrade[g] != null) countByGrade[g]++;
    });
    const remainingByGrade = { S: countByGrade.S, A: countByGrade.A, B: countByGrade.B, C: countByGrade.C };
    const waypointPlacemarks = [];
    const segmentPlacemarks = lastSegments
      .map((s, i) => {
        const grade = getSlopeLevel(s.slope);
        const styleId = grade === '—' ? 'styleTrack' : 'style' + grade;
        const coordsStr = segmentPointsToKmlCoords(s.points);
        if (grade !== '—' && remainingByGrade[grade] != null) {
          const num = remainingByGrade[grade];
          const label = grade + num;
          const startCoord =
            s.start.lon +
            ',' +
            s.start.lat +
            (s.start.ele != null ? ',' + s.start.ele : '');
          const endCoord =
            s.end.lon +
            ',' +
            s.end.lat +
            (s.end.ele != null ? ',' + s.end.ele : '');
          waypointPlacemarks.push(
            '<Placemark><name>' + label + ' START</name><Point><coordinates>' + startCoord + '</coordinates></Point></Placemark>',
            '<Placemark><name>' + label + ' END</name><Point><coordinates>' + endCoord + '</coordinates></Point></Placemark>'
          );
          remainingByGrade[grade]--;
        }
        return (
          '<Placemark><name>路段' +
          (i + 1) +
          ' (' +
          grade +
          ')</name><styleUrl>#' +
          styleId +
          '</styleUrl><LineString><coordinates>' +
          coordsStr +
          '</coordinates></LineString></Placemark>'
        );
      })
      .join('\n');
    const kml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<kml xmlns="http://www.opengis.net/kml/2.2">\n' +
      '  <Document><name>合并导出</name>\n' +
      '  ' +
      styles +
      '\n  ' +
      trackPlacemark +
      '\n  ' +
      segmentPlacemarks +
      (waypointPlacemarks.length ? '\n  ' + waypointPlacemarks.join('\n  ') : '') +
      '\n  </Document>\n</kml>';
    const blob = new Blob(['\uFEFF' + kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
    downloadBlob(blob, filename);
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
      // 水平距离 = 起点到终点之间相邻航点水平距离之和（含转弯，非起止点直线）
      let totalDist = 0;
      for (let j = startIdx; j < endIdx; j++) {
        const a = coords[j];
        const b = coords[j + 1];
        totalDist += haversineMeters(a[1], a[0], b[1], b[0]);
      }
      if (totalDist < MIN_HORIZONTAL_M) continue;
      const slope = (totalGain / totalDist) * 100;
      if (slope <= threshold) continue;
      const points = coords.slice(startIdx, endIdx + 1);
      segments.push({
        start: { lon: start[0], lat: start[1], ele: startEle },
        end: { lon: end[0], lat: end[1], ele: endEle },
        slope: Math.round(slope * 10) / 10,
        distM: Math.round(totalDist * 10) / 10,
        gainM: Math.round(totalGain * 10) / 10,
        points
      });
    }
    return segments;
  }

  function segmentPointsToKmlCoords(points) {
    return points
      .map((p) => p[0] + ',' + p[1] + (p[2] != null ? ',' + p[2] : ''))
      .join(' ');
  }

  function segmentPointsToGpxTrkpt(points) {
    return points
      .map(
        (p) =>
          '    <trkpt lat="' +
          p[1] +
          '" lon="' +
          p[0] +
          '">' +
          (p[2] != null ? '<ele>' + p[2] + '</ele>' : '') +
          '</trkpt>'
      )
      .join('\n');
  }

  function formatCoord(lon, lat) {
    const fmt = coordFormatSelect.value;
    if (fmt === 'mgrs' && typeof window.formatMGRS === 'function') {
      return window.formatMGRS(lon, lat);
    }
    return lon.toFixed(6) + ',' + lat.toFixed(6);
  }

  function renderSegmentList(segments) {
    if (!segments.length) {
      segmentListEl.innerHTML = '<p class="segment-list-empty">暂无符合条件的路段</p>';
      return;
    }
    const startColHeader = coordFormatSelect.value === 'mgrs' ? '起点(MGRS)' : '起点(经度,纬度)';
    const endColHeader = coordFormatSelect.value === 'mgrs' ? '终点(MGRS)' : '终点(经度,纬度)';
    segmentListEl.innerHTML =
      '<table><thead><tr><th>' +
      startColHeader +
      '</th><th>起点海拔(m)</th><th>' +
      endColHeader +
      '</th><th>终点海拔(m)</th><th>水平距离(m)</th><th>累积爬升(m)</th><th>坡度(%)</th><th>坡度等级</th></tr></thead><tbody>' +
      segments
        .map(
          (s) =>
            '<tr><td>' +
            formatCoord(s.start.lon, s.start.lat) +
            '</td><td>' +
            (s.start.ele != null ? s.start.ele.toFixed(1) : '—') +
            '</td><td>' +
            formatCoord(s.end.lon, s.end.lat) +
            '</td><td>' +
            (s.end.ele != null ? s.end.ele.toFixed(1) : '—') +
            '</td><td>' +
            s.distM +
            '</td><td>' +
            s.gainM +
            '</td><td>' +
            s.slope +
            '</td><td>' +
            getSlopeLevel(s.slope) +
            '</td></tr>'
        )
        .join('') +
      '</tbody></table>';
  }
})();
