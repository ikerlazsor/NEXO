const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createLoader}=require('./helpers/loadTs.cjs');
const defer=()=>{let resolve,reject;const promise=new Promise((y,n)=>{resolve=y;reject=n});return {promise,resolve,reject}};
function harness(mocks={}, initial={}) {
 const slots=[];let index=0,dirty=false,queue=[],result,props={roomId:'room-a',viewerId:'viewer',accessDenied:false,messages:[],send:async()=>{},...initial};
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={useState:initial=>{const slot=slots[index++]||={value:typeof initial==='function'?initial():initial};return [slot.value,value=>{slot.value=typeof value==='function'?value(slot.value):value;dirty=true}]},
 useRef:value=>slots[index++]||={current:value},useMemo:(fn,deps)=>{const slot=slots[index++]||={};if(!same(slot.deps,deps)){slot.deps=deps;slot.value=fn()}return slot.value},
 useEffect:(fn,deps)=>{const slot=slots[index++]||={};if(!same(slot.deps,deps)){slot.deps=deps;queue.push(()=>{slot.cleanup?.();slot.cleanup=fn()})}}};
 react.useCallback=(fn,deps)=>react.useMemo(()=>fn,deps);
 const Audio={setAudioModeAsync:async()=>{},Recording:{createAsync:async()=>({recording:{stopAndUnloadAsync:async()=>{}}}),RecordingOptionsPresets:{}},Sound:{createAsync:async()=>({sound:{unloadAsync:async()=>{},getStatusAsync:async()=>({}),setOnPlaybackStatusUpdate:()=>{}}})},RecordingOptionsPresets:{HIGH_QUALITY:{}}};
 const picker={requestMediaLibraryPermissionsAsync:async()=>({granted:true}),launchImageLibraryAsync:async()=>({canceled:false,assets:[{uri:'local-photo',type:'image'}]})};
 const load=createLoader({react,'expo-av':{Audio},'expo-image-picker':picker,'../../lib/nexoAlert':{Alert:{alert:()=>{}}},'../../lib/i18n':{useT:()=>({t:x=>x})},'../../lib/chatUpload':{uploadChatFile:async()=> 'private-url'},...mocks});
 const {useChatMedia}=load('features/chat/useChatMedia.ts');
 function render(next=props){props=next;index=0;dirty=false;result=useChatMedia(props);while(queue.length)queue.shift()();return result}
 render();
 return {get value(){return result},render,async flush(){for(let i=0;i<15;i++){await Promise.resolve();if(dirty)render()}return result},unmount(){slots.forEach(s=>s.cleanup?.())}};
}
test('one media controller selects and sends attachments for either source',async()=>{
 for(const kind of ['plan','event']){const uploads=[],sent=[];const h=harness({'../../lib/chatUpload':{uploadChatFile:async(...args)=>{uploads.push(args);return 'private-url'}}},{kind,send:async(...args)=>sent.push(args)});
 await h.value.pickMedia();await h.flush();assert.equal(h.value.pendingFiles.length,1);
 await h.value.sendPendingFiles();await h.flush();assert.equal(uploads[0][3],kind);assert.deepEqual(sent[0],['imagen','private-url']);assert.equal(h.value.pendingFiles.length,0);h.unmount();}
});
test('switching account or room during upload cannot send its attachment to the new conversation',async()=>{
 const uploaded=defer(),sent=[];const h=harness({'../../lib/chatUpload':{uploadChatFile:()=>uploaded.promise}},{send:async(...args)=>sent.push(args)});
 await h.value.pickMedia();await h.flush();const pending=h.value.sendPendingFiles();
 h.render({roomId:'room-b',viewerId:'other',accessDenied:false,messages:[],send:async(...args)=>sent.push(args)});
 uploaded.resolve('old-room-url');await pending;await h.flush();assert.equal(sent.length,0);assert.equal(h.value.pendingFiles.length,0);h.unmount();
});
test('a failed delivery can retry the prepared attachment without uploading it or duplicating a batch',async()=>{
 let uploads=0,attempts=0;const h=harness({'../../lib/chatUpload':{uploadChatFile:async()=>{uploads++;return 'same-private-url'}}},{send:async()=>{if(++attempts===1)throw Error('offline')}});
 await h.value.pickMedia();await h.flush();const first=h.value.sendPendingFiles();await h.value.sendPendingFiles();await assert.rejects(first,/offline/);await h.flush();
 assert.equal(h.value.pendingFiles.length,1);await h.value.sendPendingFiles();assert.equal(uploads,1);assert.equal(attempts,2);h.unmount();
});
test('a gallery result arriving after unmount is discarded',async()=>{
 const gallery=defer();const h=harness({'expo-image-picker':{requestMediaLibraryPermissionsAsync:async()=>({granted:true}),launchImageLibraryAsync:()=>gallery.promise}});
 const choosing=h.value.pickMedia();await h.flush();h.unmount();gallery.resolve({canceled:false,assets:[{uri:'late',type:'image'}]});await choosing;assert.equal(h.value.pendingFiles.length,0);
});
test('event transport adapts into the exact plan message model, preserving replies, attachments and deleted state',()=>{
 const load=createLoader();const {eventChatMessage}=load('features/events/chatAdapter.ts');const {encodeReplyContent,parseReplyContent}=load('lib/chatReply.ts');
 const content=encodeReplyContent('Nos vemos',{id:'quoted',name:'Ana',preview:'¿A qué hora?'});
 const item=eventChatMessage({id:'message',event_id:'room',sender_id:'person',client_id:'retry',created_at:'2026-11-15T10:00:00Z',body:content,message_type:'texto'}, {person:{nombre:'Ana',avatar_url:null}});
 assert.equal(parseReplyContent(item.contenido).text,'Nos vemos');assert.equal(item.clientKey,'retry');assert.equal(item.perfiles.nombre,'Ana');
 assert.equal(eventChatMessage({id:'deleted',body:'@@nexo_deleted@@',eliminado_en:'2026-11-15',message_type:'imagen',archivo_url:null},{}).eliminado_en,'2026-11-15');
});
test('native camera waits for readiness, rejects stale callbacks and never moves a dismissed map',()=>{
 const {createMapCameraLifecycle}=createLoader()('lib/mapCameraLifecycle.ts');const calls=[];const camera=createMapCameraLifecycle((...args)=>calls.push(args));const region={latitude:40.4,longitude:-3.7,latitudeDelta:.1,longitudeDelta:.1};
 const first=camera.open();camera.move(region,280);assert.equal(calls.length,0);camera.ready(first);assert.equal(calls.length,1);camera.close();camera.move(region,280);assert.equal(calls.length,1);
 const second=camera.open();camera.move(region,0);camera.ready(first);assert.equal(calls.length,1);camera.ready(second);assert.equal(calls.length,2);camera.move({...region,latitude:NaN},280);assert.equal(calls.length,2);
});

test('screen work waits for the native transition end and stops immediately on closing',()=>{
 let focused=true,index=0,readyState=false,effect,cleanup;let previousDeps;const listeners={},timers=new Map();let timerId=0;
 const react={useState:()=>{index++;return [readyState,value=>{readyState=value}]},useEffect:(fn,deps)=>{index++;if(!previousDeps||deps.some((x,i)=>x!==previousDeps[i])){previousDeps=deps;effect=fn}}};
 const navigation={addListener:(name,fn)=>{listeners[name]=fn;return ()=>delete listeners[name]}};
 const load=createLoader({react,'@react-navigation/native':{useIsFocused:()=>focused,useNavigation:()=>navigation}}, {setTimeout:fn=>{timers.set(++timerId,fn);return timerId},clearTimeout:id=>timers.delete(id)});
 const {useScreenTransitionReady}=load('hooks/useScreenTransitionReady.ts');
 const render=()=>{index=0;const result=useScreenTransitionReady();if(effect){const next=effect;effect=null;cleanup?.();cleanup=next()}return result};
 assert.equal(render(),false);listeners.transitionStart({data:{closing:false}});assert.equal(timers.size,0);assert.equal(render(),false);
 listeners.transitionEnd({data:{closing:false}});assert.equal(render(),true);
 listeners.transitionStart({data:{closing:true}});assert.equal(render(),false);listeners.transitionEnd({data:{closing:true}});assert.equal(render(),false);
 focused=false;assert.equal(render(),false);cleanup?.();assert.deepEqual(Object.keys(listeners),[]);
});
