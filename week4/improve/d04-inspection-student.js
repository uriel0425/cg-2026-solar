/* 개선 버전 — 큰 화면(전체 뷰) + 왼쪽 위 작은 창(상세 뷰)
   ─────────────────────────────────────────────────────────────────────────
   큰 화면 : 건물 전체를 보는 원근 뷰. X/Y/Z, WASD, Home (d04-inspection-controls.js)
   작은 창 : 관찰 과제를 하나씩 보여 주는 상세 뷰
     · 마우스 좌클릭  → P1 → P2 → … → P6 → P1 … 순서대로 표지를 정면에서 보여 줌 (원근 투영)
     · 마우스 우클릭  → O1 → O2 → O1 … 비교 화면. 작은 창이 왼쪽/오른쪽으로 나뉨 (직교 투영)
     · 비교 중 드래그 → 두 대상이 각 반쪽 화면의 가운데로 모이며 확대됨
                       위/오른쪽으로 끌면 확대, 아래/왼쪽으로 끌면 원래대로
     · H              → 비교 화면에서 숨긴 건물 배경 보이기/숨기기
   큰 화면에는 지금 작은 창이 보고 있는 지점을 원으로 표시해, 그 정보가
   건물의 어디에 있는지 함께 볼 수 있게 합니다. */
(() => {
  'use strict';
  const viewer=window.InspectionViewer;
  if(!viewer)return;
  const {canvas,model,controls,drawView}=viewer;
  const M=D.M4;

  const add=(a,b)=>a.map((v,i)=>v+b[i]);
  const scale=(a,s)=>a.map(v=>v*s);
  const lerp=(a,b,t)=>a+(b-a)*t;
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));

  // ── 화면 위에 글씨·테두리를 그릴 투명 캔버스(오버레이) ─────────────────
  const overlay=document.createElement('canvas');
  overlay.className='overlay';
  canvas.parentElement.appendChild(overlay);
  const ctx=overlay.getContext('2d');

  // ── 상태 ────────────────────────────────────────────────────────────
  const poi=model.poi;                       // P1~P6
  const comps=model.comparisons;             // O1, O2
  const ui={mode:'idle',p:-1,o:-1,zoom:0,seen:new Set(),hover:null,isolate:true};
  const groups=[...new Set(model.boxes.concat(model.signs).map(b=>b.group))];
  // mode: 'idle'(아직 선택 없음) | 'P'(표지 보기) | 'O'(비교 보기)
  // zoom: 비교 화면의 확대 정도 0(두 대상을 함께) ~ 1(각 대상을 반쪽 화면 가운데에 크게)

  /* 작은 창의 위치와 크기(그리기 버퍼 픽셀, 원점 왼쪽 아래).
     가로 화면은 폭 42%·높이 45%, 세로 화면은 폭 62%·높이 34%를 써서
     어떤 비율에서도 너무 작거나 큰 화면을 덮지 않게 합니다. */
  function insetRect(){
    const W=canvas.width,H=canvas.height,m=Math.round(Math.min(W,H)*.025);
    const portrait=W<H;
    const w=Math.round(W*(portrait?.62:.42)),h=Math.round(H*(portrait?.34:.45));
    return [m,H-m-h,w,h];
  }

  // ── 표지(P) 카메라 ─────────────────────────────────────────────────
  /* 표지의 앞면 방향 n: 표지 평면의 법선 (0,0,1)을 yaw만큼 y축으로 돌린 값.
     target = 표지 중심, eye = 표지 중심에서 n 방향으로 d만큼 떨어진 곳.
     d는 "표지 폭이 화면 폭의 25%, 높이가 화면 높이의 22%"가 되는 거리 중 큰 값.
       화면에 보이는 폭  = 2·d·tan(FOV/2)·화면비  →  d = 표지폭 / (0.25 · 2·tan(FOV/2)·화면비)
     그래서 큰 안내판(2m)은 멀리서, 작은 명판(0.28m)은 가까이서 보게 되고,
     표지 주변의 장치도 함께 보여 어느 장치의 명판인지 알 수 있습니다.
     정면에서 살짝 오른쪽·위로 비껴 서서(각 15%·12%) 입체감은 남기되 글자는 찌그러지지 않게 합니다. */
  const PFOV=40;
  function signCamera(p,aspect){
    const n=[Math.sin(p.yaw),0,Math.cos(p.yaw)];
    const right=[Math.cos(p.yaw),0,-Math.sin(p.yaw)];
    const t=Math.tan(PFOV*Math.PI/360);
    const d=Math.max(p.size[0]/(.25*2*t*aspect),p.size[1]/(.22*2*t));
    const eye=add(add(add(p.position,scale(n,d)),scale(right,d*.15)),[0,d*.12,0]);
    return {eye,target:[...p.position],up:[0,1,0],fov:PFOV,near:Math.min(.02,d*.05)};
  }

  // ── 비교(O) 카메라 ─────────────────────────────────────────────────
  // 비교 대상 상자를 모델에서 찾아 둡니다(위치·크기는 원본 그대로 읽기만 함).
  const boxById=Object.fromEntries(model.boxes.map(b=>[b.id,b]));
  /* O1: 카메라를 +z에 두고 -z를 봄, up=+y → 화면 가로 = x, 세로 = y
     O2: 카메라를 +x에 두고 -x를 봄, up=+y → 화면 가로 = z(+z가 왼쪽), 세로 = y
     둘 다 직교 투영이라 멀고 가까움과 상관없이 같은 길이는 같은 픽셀 길이로 보입니다.

     분할 화면에서 공정하게 비교하는 규칙:
       ① 두 반쪽은 halfHeight(=배율)가 항상 같다 → 1m가 양쪽에서 같은 픽셀 수
       ② "비교하는 축"의 중심 좌표는 양쪽이 같다
            O1은 높이(y)를 비교 → 두 화면의 세로 중심 y가 같음
            O2는 앞쪽 끝(z)을 비교 → 두 화면의 가로 중심 z가 같음
       ③ 비교와 상관없는 축만 각 대상 쪽으로 옮긴다
            O1은 x만 각 패널 중심으로, O2는 y만 각 장치 중심으로
     그래서 확대해도 같은 높이(O1)·같은 z(O2)는 두 화면에서 같은 줄에 놓입니다. */
  function compareSetup(c){
    const m=c.members.map(id=>boxById[id]);
    const side=c.id==='O2';
    // free: 화면에서 대상마다 따로 옮길 축, shared: 양쪽이 공유하는 비교 축
    const free=side?1:0, shared=side?2:1;
    const sharedCenter=(Math.min(...m.map(b=>b.position[shared]-b.size[shared]/2))+Math.max(...m.map(b=>b.position[shared]+b.size[shared]/2)))/2;
    const freeAll=(Math.min(...m.map(b=>b.position[free]-b.size[free]/2))+Math.max(...m.map(b=>b.position[free]+b.size[free]/2)))/2;
    /* 확대했을 때 비교 축에서 어디를 보여 줄지(focus)와 그 범위(focusSpan).
       O1은 상단 높이와 폭을 함께 봐야 하므로 패널 전체(높이 범위 그대로).
       O2는 "앞쪽(+z) 끝"만 비교하면 되므로 두 장치의 +z 끝 부근만 크게 보여 줍니다.
       어느 경우든 두 반쪽이 같은 값을 쓰므로 비교 축의 위치는 양쪽에서 같습니다. */
    let focus=sharedCenter,focusSpan=null;
    if(side){
      const fronts=m.map(b=>b.position[2]+b.size[2]/2);
      focus=(Math.min(...fronts)+Math.max(...fronts))/2;
      focusSpan=(Math.max(...fronts)-Math.min(...fronts))/2+.5;
    }
    return {m,side,free,shared,sharedCenter,freeAll,focus,focusSpan};
  }
  const setups=comps.map(compareSetup);

  /* 배율(halfHeight = 화면 세로 절반에 들어가는 월드 길이)을 정하는 방법. A = 반쪽 화면의 가로/세로 비.
       zoom=0 : 두 대상이 한 반쪽 화면에 모두 들어가는 크기 (두 반쪽이 같은 장면)
       zoom=1 : 대상 하나가 반쪽 화면 가운데에 크게 들어가는 크기
     세로축 범위가 V, 가로축 범위가 Hz일 때 둘 다 들어가려면  halfHeight = max(V, Hz / A).
     두 대상 중 큰 쪽 크기로 계산하므로 두 반쪽의 배율이 항상 같습니다. */
  function compareCameras(s,A){
    const spanFree=Math.max(...s.m.map(x=>Math.abs(x.position[s.free]-s.freeAll)+x.size[s.free]/2));
    const spanShared=Math.max(...s.m.map(x=>Math.abs(x.position[s.shared]-s.sharedCenter)+x.size[s.shared]/2));
    const oneFree=Math.max(...s.m.map(x=>x.size[s.free]/2));
    // O1: 세로 = y(공유 축), 가로 = x(대상별 축) / O2: 세로 = y(대상별 축), 가로 = z(공유 축)
    const fit=(free,shared)=>s.side?Math.max(free,shared/A):Math.max(shared,free/A);
    const wide=1.2*fit(spanFree,spanShared);
    const tight=1.3*fit(oneFree,s.focusSpan??spanShared);
    const halfHeight=lerp(wide,Math.min(wide,tight),ui.zoom);
    return s.m.map(b=>{
      const target=[0,0,0];
      target[s.shared]=lerp(s.sharedCenter,s.focus,ui.zoom);          // 비교 축: 양쪽이 같은 값
      target[s.free]=lerp(s.freeAll,b.position[s.free],ui.zoom);      // 나머지 축: 각 대상 쪽으로 이동
      const dir=s.side?[1,0,0]:[0,0,1];                               // O1은 +z, O2는 +x에서 바라봄
      return {eye:add(target,scale(dir,40)),target,up:[0,1,0],orthographic:true,halfHeight,near:1,far:120};
    });
  }

  // ── 투영 도우미: 월드 좌표 → 화면 픽셀(오버레이 표시용) ─────────────
  const view=M.create(),proj=M.create(),vp=M.create();
  function project(cam,rect,point){
    const [x,y,w,h]=rect;
    M.lookAt(view,cam.eye,cam.target,cam.up);
    if(cam.orthographic){const k=cam.halfHeight;M.ortho(proj,-k*w/h,k*w/h,-k,k,cam.near||.02,cam.far||180);}
    else M.perspective(proj,(cam.fov||45)*Math.PI/180,w/h,cam.near||.02,cam.far||180);
    M.multiply(vp,proj,view);
    const v=[...point,1],c=[0,1,2,3].map(i=>vp[i]*v[0]+vp[4+i]*v[1]+vp[8+i]*v[2]+vp[12+i]*v[3]);
    if(c[3]<=0)return null;
    const nx=c[0]/c[3],ny=c[1]/c[3];
    return [x+(nx+1)/2*w,canvas.height-(y+(ny+1)/2*h)];   // 오버레이는 원점이 왼쪽 위
  }

  // ── 그리기 ─────────────────────────────────────────────────────────
  let lastTime=performance.now();
  viewer.render=()=>{
    const now=performance.now();controls.update(Math.min(.1,(now-lastTime)/1000));lastTime=now;
    if(overlay.width!==canvas.width||overlay.height!==canvas.height){overlay.width=canvas.width;overlay.height=canvas.height;}
    ctx.clearRect(0,0,overlay.width,overlay.height);
    const dpr=canvas.width/Math.max(1,canvas.clientWidth);

    // 1) 큰 화면: 전체 뷰
    const big=controls.camera();
    const full=[0,0,canvas.width,canvas.height];
    drawView(big,full);

    // 2) 작은 창
    const r=insetRect(),[x,y,w,h]=r;
    let label='',sub='';
    if(ui.mode==='P'){
      const p=poi[ui.p],cam=signCamera(p,w/h);
      drawView(cam,r);
      label=`${p.id} ${p.name}  (${ui.p+1}/${poi.length})`;
      sub='좌클릭: 다음 지점 · 우클릭: 비교 보기';
      marker(big,full,p.position,p.id);
    }else if(ui.mode==='O'){
      const c=comps[ui.o],s=setups[ui.o],hw=Math.floor(w/2);
      const cams=compareCameras(s,hw/h);
      const halves=[[x,y,hw,h],[x+hw,y,w-hw,h]];
      /* 비교 대상만 남기고 나머지(건물·장치 등)는 작은 창에서만 잠시 숨깁니다.
         viewer.hidden은 그리는 순간에만 쓰이므로, 큰 화면은 영향을 받지 않습니다. */
      const keep=s.side?'comparison-side':'comparison-front';
      if(ui.isolate)for(const g of groups)if(g!==keep)viewer.hidden.add(g);
      drawView(cams[0],halves[0]);drawView(cams[1],halves[1]);
      viewer.hidden.clear();
      const pxPerM=(h/2)/cams[0].halfHeight/dpr;
      label=`${c.id} ${c.name} — ${c.id==='O1'?'정면(+z → −z)':'오른쪽 측면(+x → −x)'} 직교 뷰`;
      sub=`왼쪽: ${s.m[0].id} · 오른쪽: ${s.m[1].id} · 같은 배율 ${pxPerM.toFixed(0)} px/m · 드래그 확대 ${Math.round(ui.zoom*100)}% · ${ui.isolate?'배경 숨김 (H: 보이기)':'배경 표시 (H: 숨기기)'}`;
      divider(halves);
      guide(s,halves);
      axisLabels(c,halves);
      marker(big,full,c.position,c.id);
    }else{
      // 아직 선택 전: 위에서 내려다본 직교 지도로 전체 배치를 보여 줍니다.
      const k=(model.bounds.max[2]-model.bounds.min[2])/2*1.15;
      const cx=(model.bounds.min[0]+model.bounds.max[0])/2;
      drawView({eye:[cx,40,0],target:[cx,0,0],up:[0,0,-1],orthographic:true,halfHeight:Math.max(k,(model.bounds.max[0]-model.bounds.min[0])/2*1.1/(w/h)),near:1,far:80},r);
      label='상세 보기 창 (위에서 본 배치도)';
      sub='좌클릭: P1부터 표지 보기 · 우클릭: O1/O2 비교';
    }
    frame(r,label,sub);
  };

  // ── 오버레이 요소들 ─────────────────────────────────────────────────
  function px(v){return Math.round(v*(canvas.width/Math.max(1,canvas.clientWidth)));}
  function frame(rect,label,sub){
    const [x,y,w,h]=rect,top=canvas.height-y-h;
    ctx.strokeStyle='#1f6feb';ctx.lineWidth=px(3);ctx.strokeRect(x,top,w,h);
    const bar=px(40);
    ctx.fillStyle='rgba(18,35,55,.82)';ctx.fillRect(x,top,w,bar);
    ctx.fillStyle='#fff';ctx.font=`bold ${px(14)}px sans-serif`;ctx.textBaseline='top';
    ctx.fillText(label,x+px(8),top+px(4),w-px(16));
    ctx.font=`${px(11)}px sans-serif`;ctx.fillStyle='#cfe0ff';
    ctx.fillText(sub,x+px(8),top+px(22),w-px(16));
  }
  /* 큰 화면의 빨간 원. 표시할 점이 작은 창 뒤에 가려지면 작은 창 오른쪽 아래 모서리에
     "가려짐" 표시를 대신 그려, WASD로 큰 화면을 옮기면 보인다는 것을 알려 줍니다. */
  function marker(cam,rect,point,text){
    const p=project(cam,rect,point);if(!p)return;
    const [ix,iy,iw,ih]=insetRect(),itop=canvas.height-iy-ih;
    if(p[0]>=ix&&p[0]<=ix+iw&&p[1]>=itop&&p[1]<=itop+ih){
      ctx.fillStyle='#ff3b30';ctx.font=`bold ${px(12)}px sans-serif`;ctx.textBaseline='top';
      ctx.fillText(`● ${text} 위치가 이 창 뒤에 있음 (A/D로 이동)`,ix+px(4),itop+ih+px(6));
      return;
    }
    ctx.strokeStyle='#ff3b30';ctx.lineWidth=px(3);
    ctx.beginPath();ctx.arc(p[0],p[1],px(16),0,Math.PI*2);ctx.stroke();
    ctx.fillStyle='#ff3b30';ctx.font=`bold ${px(13)}px sans-serif`;ctx.textBaseline='bottom';
    ctx.fillText(text,p[0]+px(18),p[1]-px(10));
  }
  function divider(halves){
    const [x,y,,h]=halves[1],top=canvas.height-y-h;
    ctx.strokeStyle='#1f6feb';ctx.lineWidth=px(3);
    ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,top+h);ctx.stroke();
  }
  /* 기준선: 마우스가 작은 창 위에 있으면, 비교 축 방향으로 같은 위치에 선을 양쪽에 그립니다.
     O1은 가로선(같은 높이 y), O2는 세로선(같은 z). 두 반쪽의 배율과 비교 축 중심이 같으므로
     한쪽 반의 위치를 다른 반의 같은 위치로 옮기면 같은 월드 좌표가 됩니다. */
  function guide(s,halves){
    if(!ui.hover)return;
    const [hx,hy]=ui.hover;
    ctx.save();ctx.setLineDash([px(6),px(5)]);ctx.strokeStyle='#e5484d';ctx.lineWidth=px(1.5);
    for(const [x,y,w,h] of halves){
      const top=canvas.height-y-h;
      if(!s.side){ctx.beginPath();ctx.moveTo(x,hy);ctx.lineTo(x+w,hy);ctx.stroke();}
      else{
        const src=halves.find(([a,,b])=>hx>=a&&hx<a+b)||halves[0];
        const local=hx-src[0];ctx.beginPath();ctx.moveTo(x+local,top);ctx.lineTo(x+local,top+h);ctx.stroke();
      }
    }
    ctx.restore();
  }
  function axisLabels(c,halves){
    const [x,y,w,h]=halves[0],bottom=canvas.height-y;
    ctx.fillStyle='rgba(18,35,55,.75)';ctx.font=`${px(11)}px sans-serif`;ctx.textBaseline='bottom';
    ctx.fillText(c.id==='O1'?'가로 x → · 세로 y ↑':'← +z (건물 앞쪽) · 세로 y ↑',x+px(6),bottom-px(6));
  }

  // ── 마우스 입력 ─────────────────────────────────────────────────────
  /* 클릭과 드래그를 구분: 누른 뒤 6px 이상 움직이면 드래그, 아니면 클릭.
     · 클릭(좌) → 다음 P, 클릭(우) → 다음 O
     · 드래그는 비교(O) 화면에서만 확대 정도(zoom)를 바꿉니다. */
  let press=null;
  function inInset(e){
    const b=canvas.getBoundingClientRect(),dpr=canvas.width/b.width;
    const mx=(e.clientX-b.left)*dpr,my=(e.clientY-b.top)*dpr;
    const [x,y,w,h]=insetRect(),top=canvas.height-y-h;
    return mx>=x&&mx<=x+w&&my>=top&&my<=top+h?[mx,my]:null;
  }
  canvas.addEventListener('pointerdown',e=>{
    if(![0,2].includes(e.button))return;
    press={id:e.pointerId,button:e.button,x:e.clientX,y:e.clientY,zoom:ui.zoom,dragged:false};
    canvas.setPointerCapture(e.pointerId);canvas.focus();
  });
  canvas.addEventListener('pointermove',e=>{
    ui.hover=ui.mode==='O'?inInset(e):null;
    if(!press||press.id!==e.pointerId)return;
    const dx=e.clientX-press.x,dy=press.y-e.clientY;
    if(!press.dragged&&Math.hypot(dx,dy)>6){press.dragged=true;if(ui.mode==='O')controls.state.actions++;}
    if(press.dragged&&ui.mode==='O')ui.zoom=clamp(press.zoom+(dx+dy)/250,0,1);
  });
  canvas.addEventListener('pointerleave',()=>{ui.hover=null;});
  canvas.addEventListener('pointerup',e=>{
    if(!press||press.id!==e.pointerId)return;
    const p=press;press=null;
    if(p.dragged)return;
    controls.state.actions++;
    if(p.button===0){ui.mode='P';ui.p=(ui.p+1)%poi.length;ui.seen.add(poi[ui.p].id);}
    else{ui.mode='O';ui.o=(ui.o+1)%comps.length;ui.zoom=0;ui.seen.add(comps[ui.o].id);}
    markTasks();
  });
  canvas.addEventListener('pointercancel',()=>{press=null;});
  // H: 비교 화면에서 숨긴 배경을 다시 보이게 하거나 숨김
  window.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='h'&&!e.ctrlKey&&!e.metaKey){ui.isolate=!ui.isolate;controls.state.actions++;}});

  // ── 오른쪽 목록에 진행 상태 표시 ────────────────────────────────────
  // 지금 보고 있는 과제는 강조, 한 번이라도 열어 본 과제는 ✓ 표시(답은 표시하지 않음).
  const items=[...document.querySelectorAll('#tasks li')];
  function markTasks(){
    const current=ui.mode==='P'?poi[ui.p].id:ui.mode==='O'?comps[ui.o].id:null;
    model.tasks.forEach((t,i)=>{const li=items[i];if(!li)return;
      li.classList.toggle('current',t.id===current);li.classList.toggle('seen',ui.seen.has(t.id));});
  }
  viewer.status=()=>`작은 창: ${ui.mode==='P'?poi[ui.p].id:ui.mode==='O'?comps[ui.o].id+' 비교':'배치도'} · 열어 본 과제 ${ui.seen.size}/${model.tasks.length}`;
})();
