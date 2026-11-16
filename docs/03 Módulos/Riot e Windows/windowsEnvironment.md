---
tipo: módulo
arquivo: src-tauri/src/platform/windows/windows_environment.rs
camada: plataforma
testes: src-tauri/tests/platform/windows/windows_environment.rs
tags: [módulo]
---

# windowsEnvironment

> Corrige o `LOCALAPPDATA` quando o app herda o de um AppContainer temporário, para que o app e o Riot usem o perfil normal do Windows.

## Responsabilidade

- Calcula a pasta `LOCALAPPDATA` que o Riot Client realmente usa.
- Monta o ambiente dos processos do Riot iniciados pelo app.
- Não lê nem grava arquivos. Não altera o ambiente do próprio processo.

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `local_app_data_for_riot()` | função | O `LOCALAPPDATA` corrigido, o original ou `""`, a partir do ambiente do processo |
| `local_app_data_for_riot_in(ambiente)` | função | O mesmo, para um ambiente dado (testes) |
| `environment_for_riot()` | função | Cópia do ambiente do processo com `LOCALAPPDATA` corrigido |
| `environment_for_riot_from(ambiente)` | função | O mesmo, para um ambiente dado |
| `current_environment()` | função | O ambiente do processo como `HashMap` |

Regra de `local_app_data_for_riot`:

1. Lê `LOCALAPPDATA` (ausente vira `""`).
2. Se termina em `\AppData\Local\Packages\sandbox.{<guid>}\AC` (barra final opcional, sem diferenciar maiúsculas) **e** `USERPROFILE` começa com `<letra>:\`, retorna `<USERPROFILE>\AppData\Local`.
3. Senão, retorna o valor original.

## Dependências

- Usa: só `std`.
- Usado por: [[riotClient]] (caminho do `RiotGamesPrivateSettings.yaml`), [[riotProcess]] (ambiente do processo da Riot) e [[backend]] (caminho do lockfile).

## Invariantes e decisões

- **AppContainer temporário não é o perfil do Riot.** Processos iniciados por ferramentas podem herdar um `LocalAppData` de AppContainer temporário. O serviço do Riot já em execução continua dono do perfil normal do usuário.
- **Nunca inventar uma pasta.** Sem `USERPROFILE` absoluto com letra de unidade, o valor original fica como está.
- **Só o padrão `sandbox.{guid}` é corrigido.** Outros pacotes em `Packages\...\AC` e perfis em outras unidades não mudam.
- **Cópia, não mutação.** `environment_for_riot` copia o ambiente e preserva todas as outras variáveis.

## Testes

`src-tauri/tests/platform/windows/windows_environment.rs`:
- Perfil normal, outra unidade e outro pacote ficam iguais.
- `sandbox.{guid}\AC`, com e sem barra final, vira `C:\Users\<nome>\AppData\Local`.
- `USERPROFILE` ausente ou relativo não gera pasta nova; `LOCALAPPDATA` ausente vira `""`.
- `environment_for_riot_from` copia o ambiente e mantém as outras variáveis.

## Pontos de atenção

- **Padrão específico.** Só cobre o formato `sandbox.{guid}`. Outro tipo de sandbox passa direto.
- **`LOCALAPPDATA` vazio.** O [[backend]] recusa caminho não absoluto. Já o [[riotClient]] montaria o caminho do YAML relativo à pasta atual do processo.
- **Assume o local padrão.** Na correção, usa sempre `<USERPROFILE>\AppData\Local`. Um `LOCALAPPDATA` real em outro lugar não é detectado.
- Contexto: [[Desenvolvimento]], [[Limitações conhecidas]].
