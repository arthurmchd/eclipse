const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { hardenPrivateRendererSource, PRIVATE_RENDERER_MFA_MARKER } = require('../../../src/integration/host/privateRendererCore');

const original = `let useLoginForm;
useLoginForm=({error:Ge,setErrorState:Ke,setLoginFormStage:Qe,setMfaEmail:Ze,rememberMe:Je,setRememberMe:tt})=>{
const vt={current:false},Mt=clearPassword,Bt=setLoggingIn,zt=setLoading,Ht=true,zn=setGlobalLoading,
ca=useXboxAuthenticator(),
bl=async()=>{events.push("DELETE");return true},
Yr=async()=>{events.push("POST");return {type:"auth"}},
ol=async()=>{events.push("RETRY")},
Il=async()=>{if(Mt(""),Bt(!1),zt(!0),!await bl())return ol();const ei=await Yr();events.push("ORIGINAL_CONTINUATION");return ei};
return reactExports$1.useEffect(()=>{zn(Ht)},[Ht]),{initialize:Il};
};function generateQuery(Ge){return Ge}
globalThis.renderLogin=useLoginForm;`;

function fixture(initial) {
  let authentication = initial, readError;
  const events = [], effects = [], stages = [], emails = [];
  const context = {
    events,
    reactExports$1: { useEffect(callback, dependencies) { effects.push({ callback, dependencies }); } },
    RSO_AUTHENTICATOR_ENDPOINT$2: '/rso-authenticator/v1/authentication',
    getBinding: () => ({ get: async (endpoint, options) => {
      events.push(['GET', endpoint, options]);
      if (readError) throw readError;
      return authentication;
    } }),
    useXboxAuthenticator: () => authentication,
    clearPassword: () => events.push('CLEAR_PASSWORD'),
    setLoggingIn: (value) => events.push(['loggingIn', value]),
    setLoading: (value) => events.push(['loading', value]),
    setGlobalLoading: (value) => events.push(['globalLoading', value]),
  };
  vm.runInNewContext(hardenPrivateRendererSource(original, { version: '142.0.0' }), context);
  const render = () => context.renderLogin({ setLoginFormStage: (stage) => stages.push(stage), setMfaEmail: (email) => emails.push(email) });
  return { events, effects, stages, emails, render, setState(state) { authentication = state; }, failRead(error) { readError = error; } };
}

test('renderer MFA adaptation is version bounded, uniquely anchored and idempotent', () => {
  const hardened = hardenPrivateRendererSource(original, { version: '142.0.0' });
  assert.ok(hardened.includes(PRIVATE_RENDERER_MFA_MARKER));
  assert.equal(hardenPrivateRendererSource(hardened, { version: '142.0.0' }), hardened);
  assert.equal(hardenPrivateRendererSource(original, { version: '141.0.0' }), original);
  assert.throws(() => hardenPrivateRendererSource(original, { version: '143.0.0' }), /not supported/);
  for (const broken of [
    original.replace('ca=useXboxAuthenticator(),', 'ca=changedSubscription(),'),
    original.replace('Il=async()=>{if(Mt', 'Il=async()=>{if(changed'),
    `${original}${original}`,
    `${original}ca=useXboxAuthenticator(),`,
    hardened.replace('ramPrivateHydrateMfa142(ca)', 'changedHydrator(ca)'),
  ]) assert.throws(() => hardenPrivateRendererSource(broken, { version: '142.0.0' }), /layout|inconsistent/);
});

for (const [method, stage] of [['email', 'mfa_email'], ['thirdparty', 'mfa_thirdparty'], ['riotmobile', 'mfa_riotmobile']]) {
  test(`existing ${method} MFA is hydrated without deleting or restarting its authentication context`, async () => {
    const state = { type: 'multifactor', multifactor: { method, email: 'masked@example.invalid' } };
    Object.defineProperty(state, 'token', { get() { throw new Error('Tokens must not be accessed'); } });
    const f = fixture(state);
    await f.render().initialize();
    assert.deepEqual(f.stages, [stage]);
    assert.equal(f.events.filter((event) => Array.isArray(event) && event[0] === 'GET').length, 1);
    for (const mutation of ['DELETE', 'POST', 'CLEAR_PASSWORD', 'ORIGINAL_CONTINUATION']) assert.equal(f.events.includes(mutation), false);
    assert.equal(f.events.some((event) => Array.isArray(event) && event[0] === 'loading' && event[1] === false), true);
    assert.deepEqual(f.emails, method === 'email' ? ['masked@example.invalid'] : []);
  });
}

test('the authentication subscription hydrates MFA completed outside the native submit handler', () => {
  const f = fixture({ type: 'auth' });
  f.render();
  f.effects[0].callback();
  assert.deepEqual(f.stages, []);
  f.setState({ type: 'multifactor', multifactor: { method: 'email', email: 'new@example.invalid' } });
  const previousEffectCount = f.effects.length;
  f.render();
  f.effects[previousEffectCount].callback();
  assert.deepEqual(f.stages, ['mfa_email']);
  assert.deepEqual(f.emails, ['new@example.invalid']);
  assert.equal(f.events.some((event) => Array.isArray(event) && event[0] === 'GET'), false);
  assert.equal(f.events.includes('DELETE'), false);
  assert.equal(f.events.includes('POST'), false);
});

test('normal login retains the original initialization and continuation after the read-only check', async () => {
  const f = fixture({ type: 'auth' });
  await f.render().initialize();
  assert.equal(Array.isArray(f.events[0]) && f.events[0][0] === 'GET', true);
  assert.equal(f.events.includes('CLEAR_PASSWORD'), true);
  assert.ok(f.events.indexOf('POST') > f.events.indexOf('DELETE'));
  assert.ok(f.events.indexOf('ORIGINAL_CONTINUATION') > f.events.indexOf('POST'));
  assert.deepEqual(f.stages, []);
});

test('unknown or malformed MFA is preserved without assigning an unsupported stage', async () => {
  for (const multifactor of [null, {}, [], { method: 'unknown' }]) {
    const f = fixture({ type: 'multifactor', multifactor });
    await f.render().initialize();
    assert.deepEqual(f.stages, []);
    assert.equal(f.events.includes('DELETE'), false);
    assert.equal(f.events.includes('POST'), false);
  }
});

test('email metadata is constrained and never interpreted as markup', async () => {
  for (const email of [null, {}, 'x'.repeat(321), 'hidden\nvalue']) {
    const f = fixture({ type: 'multifactor', multifactor: { method: 'email', email } });
    await f.render().initialize();
    assert.deepEqual(f.emails, [null]);
    assert.deepEqual(f.stages, ['mfa_email']);
  }
});

test('failed context reads preserve authentication, while an explicitly absent context uses native initialization', async () => {
  const offline = fixture();
  offline.failRead(new Error('synthetic read failure'));
  await offline.render().initialize();
  assert.equal(offline.events.includes('DELETE'), false);
  assert.equal(offline.events.includes('POST'), false);
  const absent = fixture();
  absent.failRead({ status: 404 });
  await absent.render().initialize();
  assert.equal(absent.events.includes('DELETE'), true);
  assert.equal(absent.events.includes('POST'), true);
});
