/* WebGL2 렌더러. drawView를 여러 번 호출하면 분할 뷰를 구성할 수 있습니다.
   기본 기능은 트랙볼/이동/거리 조절/전체 보기뿐이며 자동 안내는 구현하지 않습니다. */
(() => {
  'use strict';
  const canvas=document.querySelector('#cv'),gl=canvas.getContext('webgl2',{antialias:true}),read=document.querySelector('#readings');
  if(!gl){read.textContent='WebGL2를 사용할 수 없습니다. 지원하는 브라우저에서 열어 주세요.';return;}
  const M=D.M4,model=window.InspectionModel,controls=window.InspectionControls(canvas),overviewControls=window.InspectionControls(canvas,'overview');
  const program=D.program(gl,`#version 300 es
    layout(location=0) in vec3 aPos;layout(location=1) in vec3 aNormal;layout(location=2) in vec2 aUV;
    uniform mat4 uModel,uVP;uniform mat3 uNormal;out vec3 vN;out vec2 vUV;
    void main(){vN=uNormal*aNormal;vUV=aUV;gl_Position=uVP*uModel*vec4(aPos,1.0);}
  `,`#version 300 es
    precision highp float;in vec3 vN;in vec2 vUV;uniform vec3 uColor;uniform bool uText;uniform sampler2D uMap;out vec4 outColor;
    void main(){if(uText){outColor=texture(uMap,vUV);return;}float light=.48+.52*max(dot(normalize(vN),normalize(vec3(.4,1,.6))),0.0);outColor=vec4(uColor*light,1.0);}
  `);
  const U=D.uniforms(gl,program,['uModel','uVP','uNormal','uColor','uText','uMap']);
  const cube=D.upload(gl,D.cube(1));
  const plane=D.upload(gl,{pos:new Float32Array([-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0]),nrm:new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]),uv:new Float32Array([0,0,1,0,1,1,0,1]),idx:new Uint16Array([0,1,2,0,2,3])});
  function matrix(position,size,yaw=0){const m=M.create();M.translate(m,m,position);M.rotateY(m,m,yaw);M.scale(m,m,size);return m;}
  const parts=model.boxes.map(p=>({...p,matrix:matrix(p.position,p.size)}));
  function texture(sign){
    const c=document.createElement('canvas');c.width=512;c.height=256;const ctx=c.getContext('2d');
    ctx.fillStyle='#fff9e9';ctx.fillRect(0,0,512,256);ctx.fillStyle='#122337';ctx.fillRect(0,0,512,62);
    ctx.fillStyle='#ffffff';ctx.font='bold 40px sans-serif';ctx.textAlign='center';ctx.fillText(sign.id,256,46);
    ctx.fillStyle='#122337';ctx.font='bold 60px sans-serif';ctx.fillText(sign.text[0],256,140);ctx.fillText(sign.text[1],256,220);
    const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);
    gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    return tex;
  }
  const signs=model.signs.map(p=>({...p,matrix:matrix(p.position,[...p.size,1],p.yaw),texture:texture(p)}));
  const view=M.create(),projection=M.create(),vp=M.create();
  const hidden=new Set();
  function drawMesh(mesh,m,color,text=false){gl.uniformMatrix4fv(U.uModel,false,m);gl.uniformMatrix3fv(U.uNormal,false,M.normalFrom(m));gl.uniform3fv(U.uColor,color);gl.uniform1i(U.uText,text?1:0);gl.bindVertexArray(mesh.vao);gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_SHORT,0);}
  // viewport: 그리기 버퍼의 픽셀 좌표 [x,y,width,height]. 원점은 왼쪽 아래입니다.
  function drawView(camera,viewport=[0,0,canvas.width,canvas.height],groupFilter=null){
    const [x,y,w,h]=viewport;if(w<=0||h<=0)return;
    gl.viewport(x,y,w,h);gl.enable(gl.SCISSOR_TEST);gl.scissor(x,y,w,h);D.clearColor(gl);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.disable(gl.SCISSOR_TEST);
    M.lookAt(view,camera.eye,camera.target,camera.up||[0,1,0]);
    if(camera.orthographic){const half=camera.halfHeight||8;M.ortho(projection,-half*w/h,half*w/h,-half,half,camera.near||.02,camera.far||180);}
    else M.perspective(projection,(camera.fov||controls.state.fov)*Math.PI/180,w/h,camera.near||.02,camera.far||180);
    M.multiply(vp,projection,view);gl.useProgram(program);gl.uniformMatrix4fv(U.uVP,false,vp);gl.uniform1i(U.uMap,0);gl.activeTexture(gl.TEXTURE0);
    gl.disable(gl.CULL_FACE);
    for(const p of parts)if((!groupFilter||p.group===groupFilter)&&!hidden.has(p.id)&&!hidden.has(p.group))drawMesh(cube,p.matrix,p.color);
    // 명판의 뒷면은 어두운 무지 면으로 표시하고 앞쪽에서만 글자를 읽습니다.
    for(const s of signs)if((!groupFilter||s.group===groupFilter)&&!hidden.has(s.id)&&!hidden.has(s.group)){
      drawMesh(plane,s.matrix,[.25,.28,.32]);gl.enable(gl.CULL_FACE);gl.depthFunc(gl.LEQUAL);gl.bindTexture(gl.TEXTURE_2D,s.texture);drawMesh(plane,s.matrix,[1,1,1],true);gl.depthFunc(gl.LESS);gl.disable(gl.CULL_FACE);
    }
  }
  gl.enable(gl.DEPTH_TEST);
  let started=null,last='',selectedIndex=-1,comparisonIndex=0,activeComparison=-1;
  const api={canvas,gl,model,controls,overviewControls,hidden,drawView,render:null};window.InspectionViewer=api;
  document.querySelector('#home').addEventListener('click',()=>{selectedIndex=-1;comparisonIndex=0;activeComparison=-1;controls.home();overviewControls.home();controls.state.actions++;overviewControls.state.actions++;});
  document.querySelector('#measure').addEventListener('click',()=>{started=performance.now();controls.state.actions=0;});
  canvas.addEventListener('contextmenu',e=>{
    e.preventDefault();
    const r=canvas.getBoundingClientRect();
    const inOverview=e.clientX<=r.left+r.width/3&&e.clientY<=r.top+r.height/3;
    if(inOverview)return;
    const comparison=model.comparisons[comparisonIndex];
    const yaw=comparisonIndex===0?0:Math.PI/2;
    controls.focus(comparison.position,yaw,10,{orthographic:true,halfHeight:8});
    controls.state.actions++;
    activeComparison=comparisonIndex;
    comparisonIndex=(comparisonIndex+1)%model.comparisons.length;
  });
  canvas.addEventListener('click',e=>{
    if(e.button!==0)return;
    const r=canvas.getBoundingClientRect();
    const inOverview=e.clientX<=r.left+r.width/3&&e.clientY<=r.top+r.height/3;
    if(inOverview)return;
    selectedIndex=(selectedIndex+1)%model.poi.length;
    const sign=model.poi[selectedIndex],aspect=r.width/r.height;
    const closeDistance=Math.max(sign.size[1],sign.size[0]/aspect)/(2*Math.tan(controls.state.fov*Math.PI/360))*1.12;
    overviewControls.focus(sign.position,sign.yaw,closeDistance);
    overviewControls.state.actions++;
  });
  for(const p of model.tasks){const li=document.createElement('li');const title=document.createElement('strong');title.textContent=p.id+' '+p.name;li.append(title,document.createElement('br'),document.createTextNode(p.task));document.querySelector('#tasks').appendChild(li);}
  D.loop(()=>{
    const r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    if(api.render)api.render(api);else{
      const cellWidth=Math.round(canvas.width/3),cellHeight=Math.round(canvas.height/3);
      drawView(controls.camera());
      drawView(overviewControls.camera(),[0,canvas.height-cellHeight,cellWidth,cellHeight]);
    }
    const s=controls.state,selected=selectedIndex<0?'왼쪽 클릭: P1~P6 표지판 · 오른쪽 클릭: O1/O2 직교 비교':`${model.poi[selectedIndex].id} ${model.poi[selectedIndex].name}: ${model.poi[selectedIndex].text.join(' · ')}`,comparison=s.orthographic?(activeComparison===0?'O1 전면 직교 뷰 · 파랑 A와 주황 B의 상단 높이·폭 비교':'O2 오른쪽 측면 직교 뷰 · +z 방향 돌출 비교'):'',value=`${selected}${comparison?'\n'+comparison:''}\n기본 트랙볼 · 거리 ${s.distance.toFixed(2)}m · FOV ${s.fov}°\n회전 중심 (${s.target.map(v=>v.toFixed(2)).join(', ')})\n측정 ${started===null?'시작 전':((performance.now()-started)/1000).toFixed(0)+'초'} · 기본 조작 ${s.actions}회`;
    if(value!==last){read.textContent=value;last=value;}
  });
})();
