---
tipo: memória
categoria: preferência
criada: 2026-11-18
atualizada: 2026-11-20
tags: [memória, setup]
---

# Setup novo a cada mudança

Depois de qualquer mudança no código do Eclipse, o agente sobe a versão, gera um Setup novo e instala por cima, sem perguntar antes.

**Por quê:** o usuário disse em 2026-11-18: "pode sempre fazer uma nova versao setup apos uma modificaçao" e depois "sempre que gerar um novo setup instale ele junto".

**Como aplicar:**

- Com `cargo test` e `npm test` passando, subir a versão em `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `Cargo.lock` e `tauri.conf.json`. Mudança nova sobe a versão do meio (2.9.0 → 2.10.0); correção sobe a última (2.10.2 → 2.10.3).
- Rodar `cargo tauri build` em `src-tauri/` e instalar com `Eclipse_<versão>_x64-setup.exe /S`. Se o Eclipse estava aberto, reabrir `%LOCALAPPDATA%\Eclipse\eclipse.exe`.
- Registrar a versão na linha do [[Changelog]].
- Mudança só no vault ou na configuração do agente não gera Setup.
- Isso não autoriza commit; commit continua precisando de pedido.

## Relacionado

- [[Memória]]
- [[ADR-030 Eclipse instalado por um Setup próprio]]
