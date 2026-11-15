---
tipo: módulo
arquivo: src-tauri/src/platform/windows/windows_environment.rs
camada: plataforma
testes: src-tauri/tests/platform/windows/windows_environment.rs
tags: [módulo]
---

# windowsEnvironment

> [!note] Só Rust desde 2026-11-15
> O Electron saiu do projeto ([[ADR-034 Troca do Electron pelo Tauri]]). O que esta nota conta do código JS é histórico; ele está na tag `electron-final`. O que vale hoje está nas partes sobre a versão Rust.

> Corrige o `LOCALAPPDATA` quando o app herda o de um AppContainer temporário, para que o app e o Riot usem o perfil normal do Windows.

## Responsabilidade

- Calcula a pasta `LOCALAPPDATA` que o Riot Client realmente usa.
- Monta o ambiente dos processos do Riot iniciados pelo app.
- Não lê nem grava arquivos. Não altera `process.env`.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `localAppDataForRiot(env = process.env)` | função | Retorna o `LOCALAPPDATA` corrigido, o original ou `''`. |
| `environmentForRiot(env = process.env)` | função | Cópia de `env` com `LOCALAPPDATA` corrigido. |

Regra de `localAppDataForRiot`:

1. Lê `env.LOCALAPPDATA` (ausente vira `''`).
2. Se termina em `\AppData\Local\Packages\sandbox.{<guid>}\AC` (barra final opcional, sem diferenciar maiúsculas) **e** `USERPROFILE` começa com `<letra>:\`, retorna `<USERPROFILE>\AppData\Local`.
3. Senão, retorna o valor original.

## Dependências

- Usa: só `path.win32`.
- Usado por: [[riotClient]] (caminho do `RiotGamesPrivateSettings.yaml`), [[riotProcess]] (ambiente do `spawn`) e [[backend]] (caminho do lockfile).

## Invariantes e decisões

- **AppContainer temporário não é o perfil do Riot.** Processos iniciados por ferramentas podem herdar um `LocalAppData` de AppContainer temporário. O serviço do Riot já em execução continua dono do perfil normal do usuário.
- **Nunca inventar uma pasta.** Sem `USERPROFILE` absoluto com letra de unidade, o valor original fica como está.
- **Só o padrão `sandbox.{guid}` é corrigido.** Outros pacotes em `Packages\...\AC` e perfis em outras unidades não mudam.
- **Cópia, não mutação.** `environmentForRiot` copia o ambiente e preserva todas as outras variáveis.
- **Versão Rust (fase 2 da [[Migração para Tauri]]).** `src-tauri/src/platform/windows/windows_environment.rs`, testes em `src-tauri/tests/platform/windows/windows_environment.rs`. As funções recebem o ambiente como `HashMap`, e as versões sem sufixo leem o do processo.

## Testes

`test/platform/windows/windowsEnvironment.test.js`:
- Perfil normal, outra unidade e outro pacote ficam iguais.
- `sandbox.{guid}\AC`, com e sem barra final, vira `C:\Users\<nome>\AppData\Local`.
- `USERPROFILE` ausente ou relativo não gera pasta nova; `LOCALAPPDATA` ausente vira `''`.
- `environmentForRiot` copia o objeto e mantém as outras variáveis.

## Pontos de atenção

- **Padrão específico.** Só cobre o formato `sandbox.{guid}`. Outro tipo de sandbox passa direto.
- **`LOCALAPPDATA` vazio.** O [[backend]] recusa caminho não absoluto. Já o [[riotClient]] montaria o caminho do YAML relativo à pasta atual do processo.
- **Assume o local padrão.** Na correção, usa sempre `<USERPROFILE>\AppData\Local`. Um `LOCALAPPDATA` real em outro lugar não é detectado.
- Contexto: [[Desenvolvimento]], [[Limitações conhecidas]].
