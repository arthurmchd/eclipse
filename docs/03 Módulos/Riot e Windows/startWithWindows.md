---
tipo: módulo
arquivo: src-tauri/src/platform/windows/start_with_windows.rs
camada: plataforma
testes: src-tauri/tests/platform/windows/start_with_windows.rs
tags: [módulo]
---

# startWithWindows

> Liga e desliga o início do Eclipse instalado junto com o Windows, para a opção "Iniciar com o Windows" da bandeja e das configurações dos [[cards]].

## Responsabilidade

- Diz se o Windows vai abrir o Eclipse ao entrar na conta.
- Grava ou remove a entrada do Eclipse na chave `Run` do usuário (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`) e a aprovação dela em `...\Explorer\StartupApproved\Run`.
- **Não** liga nada sozinho: só muda quando o [[main]] pede, por um clique do usuário na bandeja ou pela caixa das configurações.
- **Não** age rodando do projeto (`cargo tauri dev`): lá o executável é o de `target\debug`.

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `StartWithWindows::new(registro, executável, nome, empacotado, log)` | construtor | `registro` é a trait `StartupRegistry` (o real é o `UserRegistry`); `executável`, o que o Windows vai abrir; `nome`, o da entrada (`Eclipse`); `empacotado`, se é o app compilado em modo release; `log` recebe uma linha fixa em caso de erro |
| `available()` | método | `true` só no app compilado em modo release |
| `enabled()` | método | `true` se o Windows vai mesmo abrir o executável ao entrar. Fora do app instalado ou com erro de leitura, `false` |
| `set(ligado)` | método | Liga ou desliga e devolve o estado lido depois. Fora do app instalado, não faz nada e devolve `false` |
| `command_path(comando)`, `approved(bytes)` | funções | O executável de um comando com ou sem aspas, e se a aprovação deixa a entrada ligada |
| `RUN_KEY`, `APPROVED_KEY`, `ENABLED` | constantes | As duas chaves e os 12 bytes da aprovação ligada |

## Dependências

- Usa: a trait `StartupRegistry`; o `UserRegistry` real usa o crate `winreg` e só toca o usuário atual.
- Usado por: [[main]], que monta a opção da bandeja com `available()`, `enabled()` e `set()` e entrega o mesmo objeto ao [[appPorts]] (`startup`) para as configurações.

## Invariantes e decisões

- **Desligado até o usuário ligar.** Criado em 2026-11-08 ([[ADR-030 Eclipse instalado por um Setup próprio]]). O usuário escolheu a opção desligada por padrão; nada grava a chave `Run` no início do app.
- **Só no app instalado.** Rodando do projeto, ligar gravaria o executável de desenvolvimento, que abriria sem pasta de dados no próximo login do Windows. Por isso `available()` olha se é o app compilado em modo release, e o [[main]] nem mostra a opção.
- **Marcado é "vai abrir mesmo".** A entrada conta se o executável do comando for o do Eclipse (sem diferenciar maiúsculas e barras) e se o primeiro byte do `StartupApproved` for par, ou se ele não existir. Uma entrada desativada no Gerenciador de Tarefas aparece desmarcada; marcar de novo grava 12 bytes começando em `02`, que apagam a desativação. É a mesma leitura e gravação que o `setLoginItemSettings` do Electron fazia, para a entrada gravada por ele continuar valendo.
- **Também nas configurações.** Desde 2026-11-21, pedido do usuário: "coloque na aba das configurações uma caixa para eu escolher abrir o eclipse junto com o windows". A caixa "Iniciar com o Windows" dos [[cards]] lê e grava o registro por este mesmo objeto, via [[appPorts]] e [[managerService]]; não é um ajuste do `data.json`. Bandeja e caixa mostram o mesmo estado: salvar as configurações chama `settings_changed`, que remonta o menu da bandeja, e a página relê o estado a cada `init`. Rodando do projeto, a caixa não aparece, como a opção da bandeja.
- **Nome fixo `Eclipse`.** O valor `Run` guarda o caminho entre aspas. O desinstalador apaga esse mesmo nome (`src-tauri/windows/hooks.nsh`).
- **Desligar limpa tudo do usuário.** Desligar remove a entrada `Eclipse` e qualquer outra entrada do usuário que aponte para o mesmo executável, para a opção não continuar marcada por uma entrada antiga com outro nome. Entradas de outros programas e da máquina (`HKLM`) ficam.
- **Erro vira linha fixa.** Uma falha do registro vai ao `sign-in.log` como "could not turn on the start with Windows" ou "... off ...", sem o texto da exceção, e a opção mostra o estado lido depois.
- **Troca do Electron pelo Tauri.** O Setup do Tauri troca o caminho do valor `Run` do Electron pelo novo e mantém a aprovação do Gerenciador de Tarefas; o desinstalador apaga os dois valores, menos numa atualização ([[ADR-034 Troca do Electron pelo Tauri]]).
## Testes

`src-tauri/tests/platform/windows/start_with_windows.rs`, com um registro falso: começa desligado e liga com o nome `Eclipse` e o executável instalado; desligar remove as entradas do mesmo executável e deixa as de outros programas; uma entrada desativada lê como desligada e volta ligada; rodando do projeto, nada é lido nem gravado; falha do registro lê como desligada e registra a linha fixa; o executável é lido de um comando com ou sem aspas, e a falta de aprovação conta como ligada.

O registro real do Windows não é tocado pelos testes.

## Pontos de atenção

- Mover a pasta de instalação muda o executável; a entrada antiga continua apontando para o caminho velho até o usuário desligar e ligar de novo. O Setup de um clique sempre instala no mesmo lugar.
- A entrada guarda o caminho do executável sem argumentos. Iniciar pelo Windows é igual a abrir pelo atalho.
