---
tipo: decisão
status: aceita
data: 2026-10-26
tags: [adr, segurança]
---

# ADR-002 Segredos protegidos pelo DPAPI

## Contexto

O app guarda senhas de várias contas, chaves de API e sessões Riot que dão acesso sem senha. Também precisa passar tokens entre o gerenciador e o host privado, que roda com outro perfil Electron.

## Decisão

- Dados em repouso (senhas, chaves, sessões): `safeStorage` do Electron, que no Windows usa o DPAPI do usuário ([[store]]).
- Tokens entre processos: DPAPI direto por um auxiliar PowerShell ([[windowsDpapi]]), porque o `safeStorage` pode depender de uma chave do perfil e o host privado tem perfil próprio de propósito. Removido em 2026-11-07 junto com o host privado ([[ADR-028 Modo antigo removido]]); não há mais tokens entre processos.

## Alternativas consideradas

- **Senha mestra do app.** Mais portátil, mas obriga digitar a cada abertura e cria um segredo novo para gerenciar.
- **Credential Manager do Windows.** Exigiria dependência nativa; o DPAPI já dá a mesma garantia por usuário.

## Consequências

- Só o mesmo usuário Windows, na mesma máquina, abre os dados. Copiar `data.json` para outro PC não leva senhas.
- Não protege contra malware rodando como o próprio usuário.
- Formatar o Windows ou trocar de usuário perde os segredos; os backups também ficam ilegíveis.

## Relacionado

- [[Armazenamento e dados]] · [[Segurança e privacidade]]
