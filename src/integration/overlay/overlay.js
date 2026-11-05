document.getElementById('accounts').addEventListener('click', () => window.overlay.open().catch(() => {}));
document.getElementById('cancel').addEventListener('click', () => window.overlay.cancel().catch(() => {}));
window.overlay.onState((state) => {
  document.getElementById('accounts').hidden = state.running;
  document.getElementById('progress').hidden = !state.running;
  document.getElementById('heading').textContent = state.needsAttention ? 'Conclua a verificação da Riot' : 'Preparando seu jogo';
  document.getElementById('message').textContent = state.needsAttention ? 'Use a tela da Riot para continuar. O jogo abrirá depois da confirmação.' : 'Entrando na conta e aguardando a abertura do jogo…';
});
