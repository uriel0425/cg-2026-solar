/* Independent camera controls for the main and overview views. */
window.InspectionControls = (() => {
  let focusedView = 'main';
  return function(canvas, viewId = 'main') {
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
    const state={target:[3,3,0],distance:30,rotation:[0,0,0,1],fov:45,orthographic:false,halfHeight:8,actions:0};
    function home(){state.target=[3,3,0];state.distance=30;state.rotation=normalize(mul([0,Math.sin(.3),0,Math.cos(.3)],[Math.sin(-.22),0,0,Math.cos(.22)]));state.fov=45;state.orthographic=false;state.halfHeight=8;}
    home();
    function ownsPoint(clientX,clientY){
      const rect=canvas.getBoundingClientRect();
      const inOverview=clientX>=rect.left&&clientX<=rect.left+rect.width/3&&clientY>=rect.top&&clientY<=rect.top+rect.height/3;
      return viewId==='overview'?inOverview:!inOverview;
    }
    canvas.addEventListener('pointerdown',e=>{
      if(!ownsPoint(e.clientX,e.clientY))return;
      focusedView=viewId;
      if(viewId==='main'&&e.button===1){
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        canvas.__zoomDrag={pointerId:e.pointerId,y:e.clientY};
      }
    });
    canvas.addEventListener('pointermove',e=>{
      const drag=canvas.__zoomDrag;
      if(viewId!=='main'||!drag||drag.pointerId!==e.pointerId)return;
      const delta=e.clientY-drag.y;
      if(delta===0)return;
      state.distance=Math.max(.12,Math.min(100,state.distance*Math.exp(delta*.01)));
      state.actions++;
      drag.y=e.clientY;
    });
    for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,e=>{
      if(canvas.__zoomDrag?.pointerId===e.pointerId)canvas.__zoomDrag=null;
    });
    canvas.addEventListener('wheel',e=>{
      if(viewId!=='main'||!ownsPoint(e.clientX,e.clientY))return;
      focusedView='main';
      e.preventDefault();
      const delta=e.deltaMode===1?e.deltaY*16:e.deltaMode===2?e.deltaY*canvas.clientHeight:e.deltaY;
      state.distance=Math.max(.12,Math.min(100,state.distance*Math.exp(delta*.0025)));
      state.actions++;
    },{passive:false});
    function applyAxisView(axis){
      const axisVectors={x:[1,0,0],y:[0,1,0],z:[0,0,1]},target=axisVectors[axis];
      if(!target)return false;
      home();state.rotation=quatFromAxis([0,0,1],target);state.actions++;return true;
    }
    function focus(position,yaw,distance,view={}){
      state.target=[...position];
      state.distance=distance;
      state.rotation=quatFromAxis([0,0,1],[Math.sin(yaw),0,Math.cos(yaw)]);
      state.orthographic=Boolean(view.orthographic);
      state.halfHeight=view.halfHeight||8;
    }
    function handleKeydown(e){
      if(focusedView!==viewId)return;
      const key=e.key.toLowerCase(),allowed=['arrowleft','arrowright','arrowup','arrowdown','+','-','home','x','y','z'];
      if(!allowed.includes(key))return;
      e.preventDefault();
      if(key==='home'){home();return;}
      if(key==='+'){state.distance=Math.max(.12,state.distance/1.12);state.actions++;return;}
      if(key==='-'){state.distance=Math.min(100,state.distance*1.12);state.actions++;return;}
      if(key==='x'||key==='y'||key==='z'){applyAxisView(key);return;}
      const h=e.key==='ArrowLeft'?.06:e.key==='ArrowRight'?-.06:0,v=e.key==='ArrowUp'?.06:e.key==='ArrowDown'?-.06:0;
      state.rotation=normalize(mul(state.rotation,normalize([v,h,0,1])));state.actions++;
    }
    window.addEventListener('keydown',handleKeydown);
    function camera(){const offset=rotate(state.rotation,[0,0,state.distance]);return {eye:state.target.map((v,i)=>v+offset[i]),target:[...state.target],up:rotate(state.rotation,[0,1,0]),orthographic:state.orthographic,halfHeight:state.halfHeight};}
    return {state,home,camera,focus};
  };
})();
