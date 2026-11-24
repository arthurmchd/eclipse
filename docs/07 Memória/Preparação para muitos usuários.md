---
tipo: memória
categoria: projeto
criada: 2026-11-21
atualizada: 2026-11-21
tags: [memória, distribuição]
---

# Preparação para muitos usuários

Em 2026-11-21 o usuário pediu as cinco etapas para deixar o Eclipse vendável e usado por muita gente: testes no GitHub, helpers do Windows em Rust, atualização automática, aviso de Riot atualizada e as regras da Riot para cobrar. As cinco estão no código e no vault na 2.19.0, instalada no PC do usuário. Falta o que depende dele: guardar a chave e, se quiser, o certificado e o registro na Riot.

**Por quê:** "pode fazer todas essas etapas", depois da avaliação do código como produto. O agente não publica, não faz commit nem testa na Riot real sem pedido.

**Como aplicar:** na próxima conversa sobre o assunto, retomar por estes pontos, nesta ordem:

- Feito em 2026-11-21: conferência na Riot real ([[Changelog]], 2.19.1). Achou e corrigiu o observador que não reconhecia a janela. Falta o usuário testar o Eclipse instalado; uma falha isolada do formulário (Riot parada muito tempo na tela de login) ficou sem causa.
- Feito em 2026-11-21, a pedido do usuário: commit, envio e PR #8 no `main`; a CI passou de primeira.
- Feito em 2026-11-21: release `v2.19.1` com Setup, `.sig` e `latest.json`; o endereço da atualização responde com a 2.19.1. Quem tem 2.18 ou anterior baixa a 2.19.1 à mão uma vez; dali em diante, o aviso vem sozinho. Próximos releases seguem [[Publicar no GitHub]].
- Lembrar o usuário de guardar uma cópia da chave `%USERPROFILE%\.tauri\eclipse-updater.key` fora do PC ([[ADR-045 Atualização pelo GitHub]]).
- Assinatura de código da Microsoft (certificado pago) para o SmartScreen: só se o usuário quiser comprar.
- Cobrar: só depois de registrar o produto no portal da Riot ([[Estudo - Regras da Riot para vender o Eclipse]]).

## Relacionado

- [[Memória]]
- [[ADR-044 Helpers do Windows em Rust]]
- [[ADR-045 Atualização pelo GitHub]]
