---
tipo: módulo
arquivo: src-tauri/src/platform/windows/start_with_windows.rs
camada: plataforma
testes: src-tauri/tests/platform/windows/start_with_windows.rs
tags: [módulo]
---

# startWithWindows

> [!note] Só Rust desde 2026-11-15
> O Electron saiu do projeto ([[ADR-034 Troca do Electron pelo Tauri]]). O que esta nota conta do código JS é histórico; ele está na tag `electron-final`. O que vale hoje está nas partes sobre a versão Rust.

> Liga e desliga o início do Eclipse instalado junto com o Windows, para a opção "Iniciar com o Windows" da bandeja.

## Responsabilidade

- Diz se o Windows vai abrir o Eclipse ao entrar na conta.
- Grava ou remove a entrada do Eclipse na chave `Run` do usuário (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`), pelo `app.setLoginItemSettings` do Electron.
- **Não** liga nada sozinho: só muda quando o [[main]] pede, por um clique do usuário na bandeja.
- **Não** age rodando do projeto (`npm start`, os `.bat`): lá o executável é o `electron.exe` de `node_modules`.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createStartWithWindows({ app, execPath, name, log })` | fábrica | `app` é o `app` do Electron; `execPath`, o executável que o Windows vai abrir; `name`, o nome da entrada (`Eclipse` por padrão); `log`, uma função que recebe uma linha fixa em caso de erro. |
| `available()` | método | `true` só no app instalado (`app.isPackaged`). |
| `enabled()` | método | `true` se o Windows vai mesmo abrir o executável ao entrar (`executableWillLaunchAtLogin`). Fora do app instalado ou com erro de leitura, `false`. |
| `set(on)` | método | Liga ou desliga e devolve o estado lido depois. Fora do app instalado, não faz nada e devolve `false`. |

## Dependências

- Usa: só o `app` recebido.
- Usado por: [[main]], que monta a opção da bandeja com `available()`, `enabled()` e `set()`.

## Invariantes e decisões

- **Desligado até o usuário ligar.** Criado em 2026-11-08 ([[ADR-030 Eclipse instalado por um Setup próprio]]). O usuário escolheu a opção desligada por padrão; nada grava a chave `Run` no início do app.
- **Só no app instalado.** Rodando do projeto, ligar gravaria o `electron.exe` de `node_modules`, que abriria o Electron vazio no próximo login do Windows. Por isso `available()` olha `app.isPackaged`, e o [[main]] nem mostra a opção.
- **Marcado é "vai abrir mesmo".** O estado vem de `executableWillLaunchAtLogin`, não de `openAtLogin`. Uma entrada desativada no Gerenciador de Tarefas aparece desmarcada; marcar de novo grava com `enabled: true`, que apaga a desativação em `StartupApproved\Run`.
- **Nome fixo `Eclipse`.** A entrada não depende do AppUserModelId do Electron, que o main não define. O desinstalador apaga esse mesmo nome (`scripts/build/installer.nsh`).
- **Desligar limpa tudo do usuário.** Desligar remove a entrada `Eclipse` e qualquer outra entrada do usuário que aponte para o mesmo executável, para a opção não continuar marcada por uma entrada antiga com outro nome. Entradas de outros programas e da máquina (`HKLM`) ficam.
- **Erro vira linha fixa.** Uma falha do registro vai ao `sign-in.log` como "could not turn on the start with Windows" ou "... off ...", sem o texto da exceção, e a opção mostra o estado lido depois.
- **Versão Rust (fase 3 da [[Migração para Tauri]]).** `src-tauri/src/platform/windows/start_with_windows.rs`, testes em `src-tauri/tests/platform/windows/start_with_windows.rs`, só com um registro falso. Sem o Electron, grava ela mesma o que o `setLoginItemSettings` gravava: o valor `Eclipse` em `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, com o caminho entre aspas, e 12 bytes começando em `02` em `...\Explorer\StartupApproved\Run`. Lê como o Electron: a entrada conta se o executável do comando for o do Eclipse (sem diferenciar maiúsculas e barras) e se o primeiro byte do `StartupApproved` for par, ou se ele não existir. O registro entra pelo `StartupRegistry`; o real usa o crate `winreg` e só toca o usuário atual. `packaged` substitui o `app.isPackaged`. Nenhum teste tocou o registro real.
- **Na bandeja do Tauri (fase 5 da [[Migração para Tauri]]).** O [[main]] em Rust mostra a opção com a marca de ligado, só no app compilado em modo release, com o nome `Eclipse` e o caminho do `eclipse.exe` instalado. O Setup do Tauri troca o caminho do valor `Run` do Electron pelo novo e mantém a aprovação do Gerenciador de Tarefas; o desinstalador apaga os dois valores, menos numa atualização ([[ADR-034 Troca do Electron pelo Tauri]]).
## Testes

`test/platform/windows/startWithWindows.test.js`, com um `app` falso que imita a chave `Run`: começa desligado e liga com o nome `Eclipse` e o executável instalado; desligar remove as entradas do mesmo executável e deixa as de outros programas; uma entrada desativada lê como desligada e volta ligada; rodando do projeto, nada é lido nem gravado; falha do registro lê como desligada e registra a linha fixa. O `test/main/mainStartup.test.js` confere a opção na bandeja.

O registro real do Windows não é tocado pelos testes.

## Pontos de atenção

- Mover a pasta de instalação muda o executável; a entrada antiga continua apontando para o caminho velho até o usuário desligar e ligar de novo. O Setup de um clique sempre instala no mesmo lugar.
- A entrada guarda o caminho do executável sem argumentos. Iniciar pelo Windows é igual a abrir pelo atalho.
