module.exports = function parseRange(header, total) {
  const m=/^bytes=(\d*)-(\d*)$/i.exec(String(header).trim());
  if(!m||(!m[1]&&!m[2])||total<=0)return null;
  let start,end;
  if(!m[1]){const suffix=Number(m[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return null;start=Math.max(0,total-suffix);end=total-1;}
  else {start=Number(m[1]);end=m[2]?Number(m[2]):total-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=total||end<start)return null;
  return {start,end:Math.min(end,total-1)};
};
