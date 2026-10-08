/* 가상 구(arcball)에 포인터를 투영하는 기본 트랙볼.
   회전 상태는 쿼터니언이며 카메라의 eye/up을 함께 회전합니다. */
window.InspectionControls = function(canvas) {
  const normalize=v=>{const n=Math.hypot(...v)||1;return v.map(x=>x/n);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const mul=(a,b)=>[
    a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
    a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
    a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
    a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
  const rotate=(q,v)=>mul(mul(q,[...v,0]),[-q[0],-q[1],-q[2],q[3]]).slice(0,3);
  const quatFromAxis=(from,to)=>{
    const f=normalize(from),t=normalize(to);
    const dot=Math.max(-1,Math.min(1,f[0]*t[0]+f[1]*t[1]+f[2]*t[2]));
    if(Math.abs(dot+1)<1e-6)return [0,1,0,0];
    const axis=normalize(cross(f,t));
    const s=Math.sin(Math.acos(dot)/2);
    return [axis[0]*s,axis[1]*s,axis[2]*s,Math.cos(Math.acos(dot)/2)];
  };
  const state={target:[3,3,0],distance:30,rotation:[0,0,0,1],fov:45,actions:0,lastPointer:null,centerPointer:null};
  function home(){state.target=[3,3,0];state.distance=30;state.rotation=normalize(mul([0,Math.sin(.3),0,Math.cos(.3)],[Math.sin(-.22),0,0,Math.cos(.22)]));state.fov=45;}
  home();
  function sphere(e){const r=canvas.getBoundingClientRect(),s=Math.min(r.width,r.height),x=(2*(e.clientX-r.left)-r.width)/s,y=(r.height-2*(e.clientY-r.top))/s,d=x*x+y*y;return d<=1?[x,y,Math.sqrt(1-d)]:normalize([x,y,0]);}
  let drag=null;
  function normalizeCanvasPoint(clientX,clientY){
    const rect=canvas.getBoundingClientRect();
    return {
      x:(clientX-(rect.left+rect.width/2))/(rect.width/2),
      y:(rect.top+rect.height/2-clientY)/(rect.height/2)
    };
  }
  function resetCenterPointer(){
    const rect=canvas.getBoundingClientRect();
    const centerX=rect.left+rect.width/2;
    const centerY=rect.top+rect.height/2;
    state.lastPointer=[centerX,centerY];
    state.centerPointer=[centerX,centerY];
    canvas.__pointerPosition={clientX:centerX,clientY:centerY};
  }
  function recenterViewToPointer(sourceEvent){
    const rect=canvas.getBoundingClientRect();
    const dx=sourceEvent.clientX-(rect.left+rect.width/2);
    const dy=(rect.top+rect.height/2)-sourceEvent.clientY;
    state.lastPointer=[dx,dy];
    const unit=2*state.distance*Math.tan(state.fov*Math.PI/360)/rect.height;
    const right=rotate(state.rotation,[1,0,0]);
    const up=rotate(state.rotation,[0,1,0]);
    state.target=state.target.map((v,i)=>v-dx*unit*right[i]+dy*unit*up[i]);
    resetCenterPointer();
    state.actions++;
  }
  canvas.style.touchAction='none';
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('pointerdown',e=>{
    state.lastPointer=[e.clientX,e.clientY];
    if(drag)return;
    if(e.button===0){
      e.preventDefault();
      recenterViewToPointer(e);
      return;
    }
    if(e.button!==2)return;
    drag={id:e.pointerId,p:sphere(e),x:e.clientX,y:e.clientY,q:[...state.rotation],target:[...state.target],pan:true};
    state.actions++;canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    updatePointerPosition(e.clientX,e.clientY);
    if(!drag || drag.id!==e.pointerId)return;
    if(drag.pan){
      const r=canvas.getBoundingClientRect(),unit=2*state.distance*Math.tan(state.fov*Math.PI/360)/r.height;
      const right=rotate(drag.q,[1,0,0]),up=rotate(drag.q,[0,1,0]);
      state.target=drag.target.map((v,i)=>v-(e.clientX-drag.x)*unit*right[i]+(e.clientY-drag.y)*unit*up[i]);
    }else{
      // 현재 포인터에서 시작점으로의 역회전은 카메라를 움직여 물체가 드래그를 따라가게 합니다.
      const current=sphere(e),dot=current.reduce((v,x,i)=>v+x*drag.p[i],0);
      let q=[...cross(current,drag.p),1+dot];
      if(Math.hypot(...q)<1e-7){const axis=normalize(cross(current,Math.abs(current[0])<.9?[1,0,0]:[0,1,0]));q=[...axis,0];}
      state.rotation=normalize(mul(drag.q,normalize(q)));
    }
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,e=>{if(drag?.id===e.pointerId)drag=null;});
  canvas.addEventListener('wheel',e=>{e.preventDefault();state.distance=Math.max(.12,Math.min(100,state.distance*Math.exp(e.deltaY*.001)));state.actions++;},{passive:false});
  function applyAxisView(axis){
    const axisVectors={x:[1,0,0],y:[0,1,0],z:[0,0,1]};
    const target=axisVectors[axis];
    if(!target)return false;
    home();
    state.rotation=quatFromAxis([0,0,1],target);
    state.actions++;
    return true;
  }
  function handleKeydown(e){
    const key=e.key.toLowerCase();
    const allowed=['arrowleft','arrowright','arrowup','arrowdown','+','-','home','x','y','z'];
    if(!allowed.includes(key) && !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home'].includes(e.key))return;
    e.preventDefault();
    if(key==='home'){home();return;}
    if(key==='+'){state.distance=Math.max(.12,state.distance/1.12);state.actions++;return;}
    if(key==='-'){state.distance=Math.min(100,state.distance*1.12);state.actions++;return;}
    if(key==='x'||key==='y'||key==='z'){applyAxisView(key);return;}
    const h=e.key==='ArrowLeft'?.06:e.key==='ArrowRight'?-.06:0,v=e.key==='ArrowUp'?.06:e.key==='ArrowDown'?-.06:0;state.rotation=normalize(mul(state.rotation,normalize([v,h,0,1])));state.actions++;
  }
  window.addEventListener('keydown',handleKeydown);
  function camera(){const offset=rotate(state.rotation,[0,0,state.distance]);return {eye:state.target.map((v,i)=>v+offset[i]),target:[...state.target],up:rotate(state.rotation,[0,1,0])};}
  return {state,home,camera};
};
