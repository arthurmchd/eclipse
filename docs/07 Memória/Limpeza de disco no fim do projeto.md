---
tipo: memória
categoria: projeto
criada: 2026-11-25
atualizada: 2026-11-25
tags: [memória, build]
---

# Limpeza de disco no fim do projeto

Em 2026-11-25 a pasta do projeto ocupava 90 GB, quase tudo em `src-tauri/target/debug/` (cache do `cargo test`, que nunca apaga as versões antigas). O agente apagou esse cache com `cargo clean --profile dev` e os Setups anteriores à 2.29.0. A pasta caiu para 5,1 GB.

**Por quê:** o usuário estranhou os 89 GB e pediu: "pode apagar oq achar necessario, oq vc ainda acha que vamos usar pode deixar mesmo e no final do projeto apagamos".

**Como aplicar:** ficaram de propósito o cache do release (`src-tauri/target/release/`, cerca de 4 GB, deixa o Setup rápido), os Setups da 2.29.x e `.client-integration/` (1,3 GB, só o usuário decide). Quando o usuário encerrar o projeto, lembrar de apagar o cache do release com `cargo clean`, os Setups antigos e perguntar sobre `.client-integration/`. Enquanto isso, se o disco apertar de novo, repetir o `cargo clean --profile dev`, que é seguro: o próximo `cargo test` só recompila do zero.

## Relacionado

- [[Memória]]
- [[Setup novo a cada mudança]]
