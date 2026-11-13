---
tipo: decisão
status: aceita
data: 2026-11-13
tags: [adr, arquitetura, segurança]
---

# ADR-032 Migração para Tauri e Rust

Pedido do usuário em 2026-11-13: deixar o Eclipse mais leve. Das opções apresentadas (reescrever em C++, Tauri com Node embutido, Tauri com a lógica em Rust), o usuário escolheu Tauri com toda a lógica em Rust, migrada por fases.

## Contexto

O Eclipse é um app Electron. O instalador tem perto de 100 MB e a pasta `dist/win-unpacked` passa de 400 MB, porque o Electron leva um Chromium e um Node inteiros. A lógica do app quase não usa CPU: ela espera o Riot Client, a rede e os helpers PowerShell. Trocar de linguagem não acelera essas esperas. O ganho real está no tamanho do instalador, no tempo de abertura e, em menor grau, na memória.

O Tauri usa o WebView2, que já vem no Windows 11, e um processo nativo em Rust. Os cartões continuam em HTML, CSS e JS. O WebView2 também é um Chromium, então a economia de memória é moderada; a de disco é grande.

## Decisão

- **O Eclipse passa a ser um app Tauri 2 com a lógica em Rust**, em `src-tauri/`. Os cartões (`src/renderer/`) e os helpers PowerShell (`src/platform/windows/*.ps1`) continuam e são reaproveitados.
- **A migração é feita por fases, e o app Electron continua funcionando até a última.** `npm start`, `npm test` e o Setup atual não mudam enquanto o Tauri não cobrir tudo. Cada fase porta módulos com os testes deles.
  1. **Base:** projeto Tauri, `paths`, criptografia compatível, [[store]], [[language]] e a validação do [[managerService]].
  2. **Riot:** [[asar]], [[backend]], [[riotTransport]], [[riotState]], [[riotAuthentication]], [[riotInterface]], [[riotAppControls]], [[riotProcess]], [[gameRanks]], [[riotClient]] e [[signInFlow]], com os helpers PowerShell chamados como hoje.
  3. **Serviços:** [[signInService]], [[sessionKeeper]], [[riotWakeup]], [[rankWatcher]], [[rankApi]] e [[startWithWindows]].
  4. **Sobreposição:** janela transparente presa à Riot, região de cliques, desfoque, caixa "Ocultar contas", cobertura da coluna e a ponte `window.api` dos cartões sobre o IPC do Tauri.
  5. **Troca:** bandeja, Setup do Tauri e remoção do Electron, com uma tag no git antes, como na [[ADR-028 Modo antigo removido]].
- **Os dados do usuário continuam na mesma pasta e no mesmo formato.** `%APPDATA%\riot-account-manager\`, `data.json`, `sessions/<id>.bin` e os backups. A versão Tauri lê o que a versão Electron gravou, sem conversão.
- **A criptografia continua sendo a do `safeStorage`, lida em Rust.** No Windows, o `safeStorage` do Electron não é DPAPI direto: uma chave AES-256 aleatória fica no arquivo `Local State` da pasta de dados (`os_crypt.encrypted_key`, prefixo `DPAPI` e o blob do DPAPI), e cada segredo é `v10` + nonce de 12 bytes + AES-256-GCM. O Rust lê e grava exatamente esse formato, com a mesma chave. Assim as senhas, as chaves de API e as sessões salvas continuam abrindo, e voltar ao Electron também funciona enquanto ele existir. A proteção é a mesma da [[ADR-002 Segredos protegidos pelo DPAPI]]: só o mesmo usuário Windows, na mesma máquina.
- **As regras de [[Segurança e privacidade]] valem igual.** Nenhuma regra fica mais fraca. A view dos cartões continua sem acesso a segredos persistidos, com uma lista fechada de comandos validados no Rust. O Tauri é configurado sem acesso amplo: a view dos cartões só chama os comandos do Eclipse, sem plugins de arquivo, shell ou processo.
- **As regras de código valem para o Rust.** Sem comentários; caminhos só por `src-tauri/src/paths.rs`; dependências injetáveis por traits para tudo que toca processo, rede ou disco; os testes ficam em `src-tauri/tests/`, espelhando `src-tauri/src/`, e rodam com `cargo test`.

## Alternativas consideradas

- **Reescrever em C++.** Não acelera o que o usuário espera, porque o app passa o tempo esperando o Riot, e exigiria refazer a interface em Qt ou Win32.
- **Tauri com a lógica JS num Node embutido.** Pronto em menos tempo, mas o instalador volta a ter uns 50 MB e o ganho quase some.
- **Migrar tudo de uma vez.** Deixaria o app parado durante semanas e sem testes que provem que a nova versão faz o mesmo que a antiga.
- **Criptografia nova em Rust (DPAPI direto).** Obrigaria a converter os dados do usuário uma vez, e um erro nessa conversão perderia senhas e sessões. Manter o formato do `safeStorage` evita a conversão.

## Consequências

- Durante a migração há dois apps no repositório: o Electron em `src/` e o Tauri em `src-tauri/`. Mudança de comportamento no meio do caminho precisa entrar nos dois, ou esperar a fase do módulo.
- Desenvolver exige Rust (instalado em 2026-11-13 pelo `rustup`, no usuário) e as Build Tools do Visual Studio, já presentes.
- A parte mais arriscada é a fase 4. A sobreposição usa recursos do Electron: `setShape` para a região de cliques, várias views numa janela e a opção que desliga a detecção de oclusão do Chromium. No Tauri, isso vira chamadas diretas do Windows (`SetWindowRgn`, dono da janela, desfoque) e precisa ser conferido na Riot real.
- O formato do `Local State` é do Chromium. Se um dia o Electron mudar o prefixo (`v10`), a versão Rust precisa acompanhar enquanto os dois apps conviverem. Depois da fase 5, o formato fica congelado no Eclipse.

## Relacionado

- [[Arquitetura]]
- [[Segurança e privacidade]]
- [[Armazenamento e dados]]
- [[ADR-002 Segredos protegidos pelo DPAPI]]
- [[ADR-030 Eclipse instalado por um Setup próprio]]
