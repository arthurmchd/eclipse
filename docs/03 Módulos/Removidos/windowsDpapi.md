---
tipo: módulo
status: removido
removido-em: 2026-11-07
arquivo: src/platform/windows/windowsDpapi.js
camada: plataforma
testes: test/platform/windows/windowsDpapi.test.js
tags: [módulo]
---

# windowsDpapi

> [!note] Removido em 2026-11-07
> O helper só protegia o token da ponte e o manifesto da cópia privada. Senhas e sessões continuam no `safeStorage` do Electron ([[store]]). Ver [[ADR-028 Modo antigo removido]]. O código está na tag `modo-antigo-final` (`git checkout modo-antigo-final -- <caminho>`). Esta nota fica só como histórico.

> Protege e abre tokens entre processos com o DPAPI do Windows, no escopo do usuário atual, por um PowerShell embutido.

## Responsabilidade

- Criptografa e descriptografa strings curtas (tokens de conexão local) com `ProtectedData`.
- Expõe o script em base64 para ser embutido em outros helpers.
- Não guarda nada. Não protege as senhas das contas: isso é do [[store]].

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `protectString(value)` | função async | Retorna o valor criptografado em base64. |
| `unprotectString(value)` | função async | Recebe base64 e retorna o texto original. |
| `encodedCommand` | string | O script PowerShell em UTF-16LE base64, pronto para `-EncodedCommand`. |

## Dependências

- Usa: `child_process.execFile` e `powershell.exe`.
- Usado por: [[main]] (`protectString` como `encodeToken` do [[privateClient]] e do [[bridgeServer]]), [[privateHost]] (`unprotectString`) e [[Scripts de integração]] (o `encodedCommand` substitui `__RAM_DPAPI_HELPER_BASE64__` nos [[addons]]; o probe usa `protectString`).

## Funcionamento

1. Valida `value`: string não vazia de até 32768 caracteres. Senão "Invalid protected connection token", sem abrir processo.
2. `powershell.exe -NoProfile -NonInteractive -EncodedCommand <script>`, com `windowsHide`, `timeout: 6000`, `maxBuffer: 65536`.
3. Escreve `{ action, value }` no stdin.
4. O script usa console UTF-8, carrega `System.Security` e confere `value` de novo.
5. `protect`: `ProtectedData.Protect` com entropia `RiotAccountManager.LocalBridge.v1` e escopo `CurrentUser`, depois base64. `unprotect`: o inverso.
6. Saída: `{"ok":true,"value":"..."}` e código 0, ou `{"ok":false}` e código 1.
7. O Node aceita só `ok === true` com `value` string não vazia de até 32768 caracteres.

Qualquer falha vira "Windows could not protect or open the local connection token".

## Invariantes e decisões

- **DPAPI direto, não `safeStorage`.** Tokens entre processos precisam do DPAPI do Windows. O `safeStorage` do Electron pode usar uma chave do perfil, e a interface do projeto usa de propósito um perfil separado. Com DPAPI, o [[privateHost]] abre o que o [[main]] protegeu.
- **Token só pelo stdin.** O argumento `-EncodedCommand` leva só o script, nunca o valor.
- **Erro genérico.** A mensagem nunca inclui o valor recebido nem a saída do PowerShell.
- **Mesmo limite nos dois sentidos.** Entrada e resultado passam pelo teto de 32768 caracteres.

## Testes

`test/platform/windows/windowsDpapi.test.js`:
- Ida e volta entre processos separados, com acentos (só Windows).
- Texto cifrado inválido gera erro genérico sem o valor (só Windows).
- Vazio, `null` e valor acima de 32768 são recusados antes de chamar o Windows.

## Pontos de atenção

- **Entropia não é segredo.** Ela está no código. Qualquer processo do mesmo usuário Windows consegue abrir o token. Ver [[Segurança e privacidade]].
- **Teto também na saída.** Um valor perto de 32768 caracteres gera base64 maior que o teto e falha no `protect`.
- **Um PowerShell por chamada.** Cada operação abre um processo novo, com limite de 6 s.
- Contexto: [[Integração com o Riot Client]], [[Armazenamento e dados]].
