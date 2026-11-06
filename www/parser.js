/* OCR로 읽은 텍스트에서 구독 정보(이름, 월 요금, 다음 결제일, 무료체험 여부)를 뽑는다.
   브라우저(window.SubParser)와 Node(require) 양쪽에서 같은 코드를 쓴다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SubParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // 자주 쓰는 서비스. 공백을 뺀 형태로 비교해서 OCR이 글자 사이에 공백을 넣어도 잡는다.
  var KNOWN = [
    ['넷플릭스', ['넷플릭스', 'netflix']],
    ['유튜브 프리미엄', ['유튜브프리미엄', 'youtubepremium']],
    ['유튜브 뮤직', ['유튜브뮤직', 'youtubemusic']],
    ['디즈니플러스', ['디즈니플러스', '디즈니+', 'disney+', 'disneyplus']],
    ['왓챠', ['왓챠', 'watcha']],
    ['웨이브', ['웨이브', 'wavve']],
    ['티빙', ['티빙', 'tving']],
    ['쿠팡 와우', ['쿠팡와우', '와우멤버십', 'coupangwow']],
    ['스포티파이', ['스포티파이', 'spotify']],
    ['멜론', ['멜론', 'melon']],
    ['지니뮤직', ['지니뮤직', '지니', 'genie']],
    ['플로', ['플로', 'flomusic']],
    ['애플뮤직', ['애플뮤직', 'applemusic']],
    ['노션', ['노션', 'notion']],
    ['ChatGPT', ['chatgpt']],
    ['Claude', ['claudepro', 'claudemax', 'claude']],
    ['Google One', ['googleone', '구글원']],
    ['iCloud+', ['icloud']],
    ['Microsoft 365', ['microsoft365', 'office365']],
    ['Adobe', ['adobe', '어도비']],
    ['밀리의서재', ['밀리의서재', '밀리의서']],
    ['리디', ['리디셀렉트', '리디']],
    ['네이버 플러스 멤버십', ['네이버플러스', 'naverplus']],
    ['Instagram', ['instagram']],
    ['Discord', ['discord']],
    ['Surfshark', ['surfshark']],
    ['Duolingo', ['duolingo']]
  ];

  var NOT_NAME = [
    /결제|정기|갱신|취소|해지|관리|만료|활성|체험|혜택|프로모션|할인|환불|내역|수단|카드|계정|도움말|설정/,
    /^(구독|구독 ?목록|subscriptions?|payments?( ?(&|and) ?subscriptions?)?)$/i,
    /(billing|renews?|cancel|manage|active|expired|trial|promo|offer|account|payment)/i,
    /^\d+\s*(개|건)/
  ];

  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function validMD(m, d) { return m >= 1 && m <= 12 && d >= 1 && d <= 31; }

  // 가격 찾기. 통화 기호나 '원', 천 단위 쉼표가 있어야 가격으로 본다(날짜의 숫자를 가격으로 읽지 않기 위해).
  var PRICE_PATTERNS = [
    /(?:₩|￦|\\|W|KRW|#)\s*(\d{1,3}(?:[,.\s]\d{3})+|\d{3,6})(?!\d)/i,
    /(?<![\d,.])(\d{1,3}(?:[,.\s]\d{3})+|\d{3,6})\s*원/,
    // 통화 기호를 못 읽었어도 '결제 예정' 바로 앞의 숫자는 금액으로 본다.
    /(?<![\d,.])(\d{1,3}(?:,\d{3})+|\d{3,6})\s*(?:에\s*)?결제\s*예정/,
    // 기호 없이 쉼표 숫자만 있는 경우는 결제 문맥이 있을 때만(예: 'Over 4,500 VPN servers'를 거른다).
    /(?<![\d,.])(\d{1,3}(?:,\d{3})+)(?![\d,])/
  ];

  function findPrice(line) {
    for (var i = 0; i < PRICE_PATTERNS.length; i++) {
      var m = PRICE_PATTERNS[i].exec(line);
      if (!m) continue;
      if (i === 3 && !/결제|예정|원|월|month|mo\b/i.test(line)) continue;
      var value = parseInt(m[1].replace(/[,.\s]/g, ''), 10);
      if (!value) continue;
      var after = line.slice(m.index + m[0].length, m.index + m[0].length + 8);
      var yearly = /(\/|\s)?\s*(년|연|year|yr)/i.test(after) && !/(월|달|month|mo)/i.test(after);
      var monthly = value;
      if (yearly) monthly = Math.round(value / 12 / 10) * 10;
      if (monthly < 300 || monthly > 500000) continue;
      return { index: m.index, length: m[0].length, price: monthly, yearly: yearly };
    }
    return null;
  }

  function findDate(text, today) {
    var m = /(20\d{2})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/.exec(text);
    if (m && validMD(+m[2], +m[3])) return iso(+m[1], +m[2], +m[3]);

    m = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(text);
    if (m && validMD(+m[1], +m[2])) return inferYear(+m[1], +m[2], today);

    // '월'을 숫자 8이나 B로 잘못 읽은 경우("12월 8일" -> "128 8일"). 결제 문맥이 있을 때만 보정한다.
    if (/결제|종료|갱신/.test(text)) {
      m = /(\d{1,2})\s*[8B]\s*(\d{1,2})\s*일/.exec(text);
      if (m && validMD(+m[1], +m[2])) return inferYear(+m[1], +m[2], today);
    }

    m = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:\s*,\s*(20\d{2}))?/i.exec(text);
    if (m) {
      var mm = MONTHS[m[1].toLowerCase()], dd = +m[2];
      if (validMD(mm, dd)) return m[3] ? iso(+m[3], mm, dd) : inferYear(mm, dd, today);
    }
    return null;
  }

  // 연도가 없는 날짜는 다음 결제일이므로, 이미 지난 날짜면 내년으로 본다.
  function inferYear(m, d, today) {
    var t = today || new Date();
    var y = t.getFullYear();
    var cand = new Date(y, m - 1, d);
    var base = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    if (cand < base) y += 1;
    return iso(y, m, d);
  }

  function nospace(s) { return s.toLowerCase().replace(/\s+/g, ''); }

  function canonical(name) {
    var n = nospace(name);
    if (!n) return null;
    for (var i = 0; i < KNOWN.length; i++) {
      var keys = KNOWN[i][1];
      for (var k = 0; k < keys.length; k++) {
        if (n.indexOf(keys[k]) !== -1) return KNOWN[i][0];
      }
    }
    return null;
  }

  function cleanName(s) {
    s = s.replace(/[|_~•·●○▪■□◆◇▶►▷›»]/g, ' ');
    var tokens = s.split(/\s+/).filter(Boolean);
    // 맨 앞의 기호만 있는 토큰(앱 아이콘 오인식)은 버린다.
    while (tokens.length && !/[\p{L}\p{N}]/u.test(tokens[0])) tokens.shift();
    // 앱 아이콘이 'OO', '@' 같은 글자로 읽힌 경우
    if (tokens.length >= 2 && /^[OoQ0@©®]{1,3}$/.test(tokens[0])) tokens.shift();
    s = tokens.join(' ');
    s = s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+)\]]+$/gu, '').trim();
    return s;
  }

  // 'Spotify: 음악과 팟캐스트', 'Discord - Talk, Play' 처럼 뒤에 붙은 설명은 뗀다.
  function shortName(name) {
    var first = name.split(/\s*[:：]\s*|\s+[-–]\s+/)[0].trim();
    return first.length >= 2 ? first : name;
  }

  function isNameLine(raw) {
    var t = cleanName(raw);
    if (t.length < 2 || t.length > 40) return false;
    if (!/\p{L}/u.test(t)) return false;
    if (canonical(t)) return true;
    for (var i = 0; i < NOT_NAME.length; i++) if (NOT_NAME[i].test(t)) return false;
    if (findPrice(t) || /20\d{2}\s*[.\-\/년]/.test(t)) return false;
    return true;
  }

  function parse(text, today) {
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var items = [];

    for (var i = 0; i < lines.length; i++) {
      var pm = findPrice(lines[i]);
      if (!pm) continue;

      // 이름: 같은 줄 앞부분, 없으면 위쪽 줄에서 가장 가까운 이름 같은 줄
      var name = null;
      var prefix = lines[i].slice(0, pm.index);
      // 구글 플레이 구독 화면은 '앱 이름 / 상품명 / 다음 결제: ... 결제 예정' 순서라서 두 줄 위가 앱 이름이다.
      if (/다음\s*결제|결제\s*예정/.test(lines[i])) {
        var gp = [i - 2, i - 1];
        for (var g = 0; !name && g < gp.length; g++) {
          var gl = lines[gp[g]];
          if (gp[g] >= 0 && !findPrice(gl) && isNameLine(gl)) name = canonical(gl) || shortName(cleanName(gl));
        }
      }
      if (!name && isNameLine(prefix)) name = canonical(prefix) || cleanName(prefix);
      for (var j = i - 1; !name && j >= Math.max(0, i - 3); j--) {
        if (findPrice(lines[j])) break;
        if (isNameLine(lines[j])) name = canonical(lines[j]) || cleanName(lines[j]);
      }
      if (!name) continue;

      // 날짜와 무료체험 여부: 가격 줄 앞뒤를 함께 본다
      var windowText = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 4)).join('\n');
      var after = lines.slice(i, Math.min(lines.length, i + 4)).join('\n');
      var date = findDate(after, today) || findDate(windowText, today);
      var trial = /무료\s*체험|무료\s*평가|free\s*trial/i.test(windowText);

      items.push({ name: name, price: pm.price, date: date, trial: trial, yearly: pm.yearly });
    }

    // 같은 이름+금액은 한 번만
    var seen = {}, out = [];
    items.forEach(function (it) {
      var key = nospace(it.name) + '|' + it.price;
      if (seen[key]) return;
      seen[key] = true;
      out.push(it);
    });
    return out;
  }

  return {
    parse: parse, findPrice: findPrice, findDate: findDate, canonical: canonical,
    isNameLine: isNameLine, cleanName: cleanName
  };
});
