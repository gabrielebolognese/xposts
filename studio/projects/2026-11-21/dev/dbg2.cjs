// manual integration of radial eq only to check
const a=0.94, lam=-2*Math.sin(1.2566), eta=(4-a*a)*Math.cos(1.2566)**2, Q=eta+(lam-a)**2;
const Rf=r=>{const P=r*r+a*a-a*lam;return P*P-(r*r-2*r+a*a)*Q;};
const acc=r=>{const P=r*r+a*a-a*lam;return 2*r*P-(r-1)*Q;};
let r=1000, v=-Math.sqrt(Rf(r));
for(let i=0;i<120;i++){const ds=0.06/(Math.abs(v)/r+1e-6);
 const k1r=v,k1v=acc(r); const k2r=v+0.5*ds*k1v,k2v=acc(r+0.5*ds*k1r); const k3r=v+0.5*ds*k2v,k3v=acc(r+0.5*ds*k2r); const k4r=v+ds*k3v,k4v=acc(r+ds*k3r);
 r+=ds/6*(k1r+2*k2r+2*k3r+k4r); v+=ds/6*(k1v+2*k2v+2*k3v+k4v);
 if(i%10==0||r<60)console.log(i,r.toFixed(3),v.toExponential(4),Math.sqrt(Math.max(0,Rf(r))).toExponential(4));}
