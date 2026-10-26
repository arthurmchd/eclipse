const PRIVATE_RENDERER_MFA_MARKER = 'RAM_PRIVATE_RENDERER_MFA_CONTEXT_V1';
const HOOK_START = 'useLoginForm=({error:Ge,setErrorState:Ke,setLoginFormStage:Qe,setMfaEmail:Ze,rememberMe:Je,setRememberMe:tt})=>{';
const HOOK_END = ';function generateQuery(';
const AUTH_SUBSCRIPTION = 'ca=useXboxAuthenticator(),';
const ORIGINAL_INITIALIZE = 'Il=async()=>{if(Mt(""),Bt(!1),zt(!0),!await bl())return ol();';
const ORIGINAL_EFFECTS = 'return reactExports$1.useEffect(()=>{zn(Ht)},[Ht]),';

// The native MFA components and completion handlers remain unchanged. This
// adapter only supplies the stage/email that the native submit handler would
// otherwise set after receiving the same authentication response itself.
const MFA_HELPER = `ramPrivateHydrateMfa142=Jr=>{
/* ${PRIVATE_RENDERER_MFA_MARKER} */
if(vt.current||!Jr||Jr.type!=="multifactor"||!Jr.multifactor||typeof Jr.multifactor!=="object"||Array.isArray(Jr.multifactor))return!1;
const ei=Jr.multifactor.method;
let Do;
if(ei==="thirdparty")Do="mfa_thirdparty";
else if(ei==="riotmobile")Do="mfa_riotmobile";
else if(ei==="email"){
Do="mfa_email";
const tc=Jr.multifactor.email;
Ze(typeof tc==="string"&&tc.length<=320&&!/[\\x00-\\x1f\\x7f]/.test(tc)?tc:null);
}else return!1;
Bt(!1),zt(!1),Qe(Do);
return!0;
},`;

const PRIVATE_INITIALIZE = `${MFA_HELPER}Il=async()=>{
try{
const ramPrivateExistingMfa142=await getBinding().get(RSO_AUTHENTICATOR_ENDPOINT$2,{skipCache:!0});
if(ramPrivateExistingMfa142&&ramPrivateExistingMfa142.type==="multifactor"){
if(!ramPrivateHydrateMfa142(ramPrivateExistingMfa142))Bt(!1),zt(!1);
return;
}
}catch(ramPrivateAuthReadError142){
if(ramPrivateAuthReadError142?.status!==404&&ramPrivateAuthReadError142?.status!=="404"){Bt(!1),zt(!1);return;}
}
if(Mt(""),Bt(!1),zt(!0),!await bl())return ol();`;
const PRIVATE_EFFECTS = 'return reactExports$1.useEffect(()=>{ramPrivateHydrateMfa142(ca)},[ca]),reactExports$1.useEffect(()=>{zn(Ht)},[Ht]),';

function occurrences(source, value) {
  let count = 0, offset = 0;
  while ((offset = source.indexOf(value, offset)) !== -1) { count++; offset += value.length; }
  return count;
}

function requireUnique(source, anchor) {
  if (occurrences(source, anchor) !== 1) throw new Error('This Riot login renderer layout is not supported');
}

function hardenPrivateRendererSource(source, { version } = {}) {
  if (typeof source !== 'string') throw new Error('Private UI renderer source is invalid');
  if (version === '141.0.0') return source;
  if (version !== '142.0.0') throw new Error('This Riot login renderer version is not supported');

  for (const anchor of [HOOK_START, HOOK_END, AUTH_SUBSCRIPTION]) requireUnique(source, anchor);
  const beginning = source.indexOf(HOOK_START), ending = source.indexOf(HOOK_END);
  if (ending <= beginning || source.indexOf(AUTH_SUBSCRIPTION) <= beginning || source.indexOf(AUTH_SUBSCRIPTION) >= ending) throw new Error('This Riot login renderer layout is not supported');

  if (source.includes(PRIVATE_RENDERER_MFA_MARKER)) {
    requireUnique(source, PRIVATE_RENDERER_MFA_MARKER);
    requireUnique(source, PRIVATE_INITIALIZE);
    requireUnique(source, PRIVATE_EFFECTS);
    if (source.includes(ORIGINAL_INITIALIZE) || source.includes(ORIGINAL_EFFECTS)) throw new Error('Private UI renderer MFA adapter is inconsistent');
    return source;
  }
  if (source.includes('ramPrivateHydrateMfa142')) throw new Error('Private UI renderer MFA adapter is inconsistent');
  for (const anchor of [ORIGINAL_INITIALIZE, ORIGINAL_EFFECTS]) {
    requireUnique(source, anchor);
    const position = source.indexOf(anchor);
    if (position <= beginning || position >= ending) throw new Error('This Riot login renderer layout is not supported');
  }
  const result = source.replace(ORIGINAL_INITIALIZE, () => PRIVATE_INITIALIZE).replace(ORIGINAL_EFFECTS, () => PRIVATE_EFFECTS);
  // The bundle is an ES module (and contains import.meta elsewhere). Parse
  // the modified hook as a standalone assignment without executing it.
  new Function(result.slice(beginning, result.indexOf(HOOK_END)) + ';');
  return result;
}

module.exports = { hardenPrivateRendererSource, PRIVATE_RENDERER_MFA_MARKER };
