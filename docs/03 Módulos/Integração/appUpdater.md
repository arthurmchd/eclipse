---
tipo: módulo
arquivo: src-tauri/src/integration/app_updater.rs
camada: integração
testes: src-tauri/tests/integration/app_updater.rs
tags: [módulo]
---

# appUpdater

> O `UpdateSource` real do [[updates]]: pergunta ao GitHub pelo `tauri-plugin-updater`, baixa o Setup novo, confere a assinatura e o roda.

## Responsabilidade

- `check`: baixa o `latest.json` do último release e devolve a versão, se for mais nova que a instalada.
- `install`: baixa o Setup da versão encontrada, confere a assinatura com a chave pública do `tauri.conf.json`, para o Eclipse e roda o Setup com a barra de progresso (`passive`) e `/UPDATE`. O Setup reabre o Eclipse.
- Não decide quando perguntar nem se pode instalar: isso é do [[updates]].

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `AppUpdater::new(app, antes_de_sair)` | construtor | `antes_de_sair` roda logo antes do Setup; o [[main]] passa o mesmo `quit` do "Sair" da bandeja |
| `ENDPOINT` | constante | `https://github.com/arthurmchd/eclipse/releases/latest/download/latest.json`, igual ao `plugins.updater.endpoints` do `tauri.conf.json` |
| `TIMEOUT_SECS` | constante | 30 s por pedido |

## Dependências

- Usa: `tauri-plugin-updater` 2.14, registrado no `main()` do [[main]].
- Usado por: [[main]], dentro do [[updates]].

## Invariantes e decisões

- **Assinatura antes de rodar (2026-11-21, [[ADR-045 Atualização pelo GitHub]]).** O plugin só roda um Setup cuja assinatura confere com a chave pública do `tauri.conf.json`. A chave privada fica em `%USERPROFILE%\.tauri\eclipse-updater.key`, nunca no repositório; o `.gitignore` também barra `*.key`.
- **O que o GitHub recebe.** O IP e um pedido do `latest.json` com o agente `tauri-plugin-updater/2.14.1`. O endereço não usa as variáveis do plugin (`{{current_version}}` e outras), então nem a versão instalada vai junto.
- **A versão encontrada fica guardada.** `check` guarda o `Update` do plugin, e `install` usa esse mesmo; sem um `check` antes, `install` falha.
- **Saída limpa.** O plugin encerra o processo com `exit(0)` logo depois de abrir o Setup. Antes disso, chama o `antes_de_sair`, que para os serviços como o "Sair" da bandeja, para o observador devolver a animação da Riot ([[riotWindowObserver]]).
- **Erros sem detalhe.** Qualquer erro do plugin vira `UpdateFailure`, e o [[updates]] só registra uma linha fixa.

## Testes

`src-tauri/tests/integration/app_updater.rs` confere no `tauri.conf.json` o endereço igual a `ENDPOINT`, o modo `passive`, uma chave pública do minisign (e não uma privada) e `createUpdaterArtifacts` ligado. A pergunta e a instalação reais precisam de um release publicado e não têm teste automático.

## Pontos de atenção

- Sem a variável `TAURI_SIGNING_PRIVATE_KEY`, o `cargo tauri build` falha ao assinar ([[Desenvolvimento]]).
- Chave perdida: nenhum Eclipse instalado aceita a próxima versão; cada usuário teria de baixar o Setup à mão uma vez.
