// Xenon Night: one of the 6 Monte Carlo workers. {type:'mat', m} sets the material snapshot;
// {type:'gen', sites, n, seed, k, tracks} runs one share of a generation and replies with tallies, bank and tracks.
importScripts('mc.js');
const mc = self.MCK.createMC();
onmessage = (e) => {
  const d = e.data;
  if (d.type === 'mat') {
    mc.setMaterial(d.m);
  } else if (d.type === 'gen') {
    const t0 = performance.now();
    const r = mc.run(d.sites, d.n, d.seed, d.k, d.tracks);
    r.ms = performance.now() - t0;
    r.id = d.id;
    r.gen = d.gen;
    const transfer = [r.bank.buffer, ...r.tracks.map((t) => t.buffer)];
    postMessage(r, transfer);
  }
};
