/* 개선 버전의 큰 화면(전체 뷰) 조작.
   기본 버전의 트랙볼·평행 이동·휠 조작은 모두 제거하고 다음만 남깁니다.
     X / Y / Z : 각 축의 +방향에서 건물 전체를 바라보는 시점으로 이동
     W / S     : 화면 기준 위 / 아래로 이동
     A / D     : 화면 기준 왼쪽 / 오른쪽으로 이동 (누르고 있는 동안 계속 이동)
     마우스 휠 : 바라보는 방향으로 앞으로(확대) / 뒤로(축소) 이동
     Home      : 처음 시점(기본 버전과 같은 비스듬한 전체 보기)으로 복귀
   카메라는 eye(눈 위치), target(바라보는 점), up(화면 위쪽 방향) 세 값으로 표현합니다. */
window.InspectionControls = function(canvas) {
  const add=(a,b)=>a.map((v,i)=>v+b[i]);
  const sub=(a,b)=>a.map((v,i)=>v-b[i]);
  const scale=(a,s)=>a.map(v=>v*s);
  const normalize=v=>{const n=Math.hypot(...v)||1;return v.map(x=>x/n);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

  // 모델 전체를 감싸는 상자(model.bounds)의 중심과 크기. 축 시점의 기준점이 됩니다.
  const bounds=window.InspectionModel.bounds;
  const center=bounds.min.map((v,i)=>(v+bounds.max[i])/2);
  const extent=bounds.max.map((v,i)=>v-bounds.min[i]);

  const state={eye:[0,0,0],target:[...center],up:[0,1,0],fov:45,actions:0,view:'전체 보기',distance:0};

  // 처음 시점: 기본 버전 home()과 같은 위치(회전 중심 (3,3,0), 거리 30m, 같은 회전)를 그대로 계산해 둡니다.
  function home(){
    const q1=[0,Math.sin(.3),0,Math.cos(.3)],q2=[Math.sin(-.22),0,0,Math.cos(.22)];
    const mul=(a,b)=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
    const q=normalize(mul(q1,q2)),rot=v=>mul(mul(q,[...v,0]),[-q[0],-q[1],-q[2],q[3]]).slice(0,3);
    state.target=[3,3,0];state.eye=add(state.target,rot([0,0,30]));state.up=rot([0,1,0]);
    state.view='전체 보기';
  }

  /* 축 시점. dir은 카메라가 놓이는 방향(+x, +y, +z).
     관찰 거리 d는 "건물이 화면에 다 들어오는 거리"로 정합니다.
       세로로 다 보이려면  d = (보일 높이/2) / tan(FOV/2)
       가로로 다 보이려면  d = (보일 폭/2)   / (tan(FOV/2) × 화면비)
     둘 중 큰 값을 쓰고 10% 여유를 둔 뒤, 건물 두께의 절반을 더해 앞면이 잘리지 않게 합니다. */
  function axisView(axis){
    const t=Math.tan(state.fov*Math.PI/360),aspect=canvas.width/Math.max(1,canvas.height);
    let dir,up,w,h,depth;
    if(axis==='x'){dir=[1,0,0];up=[0,1,0];w=extent[2];h=extent[1];depth=extent[0];}       // 화면 가로 = z
    else if(axis==='y'){dir=[0,1,0];up=[0,0,-1];w=extent[0];h=extent[2];depth=extent[1];} // 위에서 내려다봄, 화면 위쪽 = 뒤(-z)
    else {dir=[0,0,1];up=[0,1,0];w=extent[0];h=extent[1];depth=extent[2];}                 // 정면, 화면 가로 = x
    const d=Math.max(h/2/t,w/2/(t*aspect))*1.1+depth/2;
    state.target=[...center];state.eye=add(center,scale(dir,d));state.up=up;
    state.view='+'+axis.toUpperCase()+' 방향에서 보기';
  }

  /* 카메라를 화면 기준으로 옮기는 세 방향
       forward = target − eye 를 정규화 → 카메라가 바라보는 방향(화면 안쪽)
       right   = forward × up           → 화면의 오른쪽
       screenUp= right × forward        → 화면의 위쪽 (forward와 직각이 되게 다시 계산)
     WASD는 화면과 나란한 평면 위에서 움직이므로(위·아래·왼쪽·오른쪽) 물체 크기는 그대로이고,
     휠만 forward 방향으로 움직여 물체가 커지거나(확대) 작아집니다(축소).
     eye와 target을 같은 양만큼 옮기므로 바라보는 각도는 바뀌지 않습니다.
     (방향키 회전 같은 기본 버전 조작은 없습니다.) */
  function axes(){
    const forward=normalize(sub(state.target,state.eye));
    const right=normalize(cross(forward,state.up));
    const screenUp=cross(right,forward);
    return {forward,right,screenUp};
  }
  function shift(v){state.eye=add(state.eye,v);state.target=add(state.target,v);}

  const held=new Set();
  function update(dt){
    if(!held.size)return;
    const {right,screenUp}=axes();
    let move=[0,0,0];
    if(held.has('w'))move=add(move,screenUp);
    if(held.has('s'))move=sub(move,screenUp);
    if(held.has('d'))move=add(move,right);
    if(held.has('a'))move=sub(move,right);
    if(Math.hypot(...move)<1e-6)return;
    shift(scale(normalize(move),8*dt));               // 초당 8m
  }

  window.addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    const k=e.key.toLowerCase();
    if(['w','a','s','d'].includes(k)){e.preventDefault();if(!held.has(k)&&!e.repeat)state.actions++;held.add(k);return;}
    if(['x','y','z'].includes(k)){e.preventDefault();state.actions++;axisView(k);return;}
    if(e.key==='Home'){e.preventDefault();state.actions++;home();}
  });
  window.addEventListener('keyup',e=>held.delete(e.key.toLowerCase()));
  window.addEventListener('blur',()=>held.clear());
  canvas.addEventListener('contextmenu',e=>e.preventDefault());

  /* 휠: 한 칸(deltaY ≈ 100)마다 1.5m씩 바라보는 방향으로 이동.
     휠을 위로 굴리면 deltaY < 0 → 앞으로(확대), 아래로 굴리면 뒤로(축소).
     페이지가 스크롤되지 않도록 기본 동작을 막습니다. */
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();
    const unit=e.deltaMode===1?33:e.deltaMode===2?canvas.clientHeight:1;  // 줄·페이지 단위를 픽셀로 맞춤
    const step=-e.deltaY*unit/100*1.5;
    shift(scale(axes().forward,Math.max(-6,Math.min(6,step))));
    state.actions++;
  },{passive:false});

  home();
  function camera(){state.distance=Math.hypot(...sub(state.eye,state.target));return {eye:[...state.eye],target:[...state.target],up:[...state.up],fov:state.fov};}
  return {state,home,axisView,update,camera};
};
