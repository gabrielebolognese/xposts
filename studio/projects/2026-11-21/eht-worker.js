// EHT worker: direct Fourier transforms of the 96 x 96 image crop at sampled (u, v) points, and dirty image / dirty
// beam rows from the sampled visibilities (EHT.vis / EHT.dirty in eht.js).
importScripts('eht.js');
const E = self.EHT;
let img = null, ax = null, pts = null;
self.onmessage = (e) => {
  const m = e.data;
  if (m.cmd === 'img') {
    img = m.img; ax = m.ax; // no reply: queued ahead of the transforms that use it
  } else if (m.cmd === 'pts') {
    pts = m.pts; // no reply: queued ahead of the dirty-image rows that use it
  } else if (m.cmd === 'vis') {
    const r = E.vis(img, ax, m.uv);
    self.postMessage({ cmd: 'vis', tag: m.tag, re: r.re, im: r.im, n: m.uv.length >> 1 }, [r.re.buffer, r.im.buffer]);
  } else if (m.cmd === 'blur') {
    const out = E.blur(img, m.fwhmPix);
    self.postMessage({ cmd: 'blur', out, tag: m.tag }, [out.buffer]);
  } else if (m.cmd === 'fit') {
    self.postMessage({ cmd: 'fit', tag: m.tag, fit: E.ringFit(m.bins), bins: m.bins });
  } else if (m.cmd === 'dirty') {
    const out = E.dirty(m.ax || ax, pts, m.y0, m.y1, m.beam);
    self.postMessage({ cmd: 'dirty', tag: m.tag, y0: m.y0, y1: m.y1, beam: m.beam, out }, [out.buffer]);
  }
};
