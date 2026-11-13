---
tipo: módulo
arquivo: src-tauri/src/platform/windows/safe_storage.rs
camada: plataforma
testes: src-tauri/tests/platform/windows/safe_storage.rs
tags: [módulo, tauri, segurança]
---

# safeStorage

> Criptografia dos segredos na versão Tauri, no mesmo formato do `safeStorage` do Electron, para as senhas, chaves e sessões já salvas continuarem abrindo.

## Responsabilidade

- Lê e, se ainda não existir, cria a chave AES-256 do arquivo `Local State` da pasta de dados.
- Cifra e decifra segredos no formato `v10` do Chromium.
- `dpapi.rs`, ao lado, chama `CryptProtectData` e `CryptUnprotectData` do Windows.
- **Não** sabe onde cada segredo é guardado. Isso é do [[store]], que recebe o `Cipher` pronto.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `Cipher` | trait | `encrypt(bytes)` e `decrypt(bytes)`; o [[store]] depende só dela |
| `SafeStorage::new(pasta, protetor)` | construtor | Usa `<pasta>/Local State`; não lê nada até o primeiro uso |
| `LOCAL_STATE_FILE` | constante | `"Local State"` |
| `KeyProtector` | trait (`dpapi.rs`) | `protect` e `unprotect` da chave; os testes trocam por um falso |
| `Dpapi` | struct (`dpapi.rs`) | O DPAPI real, sem interface (`CRYPTPROTECT_UI_FORBIDDEN`) |

## Dependências

- Usa: `aes-gcm`, `base64`, `serde_json`, `windows-sys`.
- Usado por: [[store]] (fase 1). O `main.rs` ainda não o cria; isso entra na fase 3.

## Invariantes e decisões

- **Mesmo formato do Electron.** Conferido em 2026-11-13 com o Electron 44 do projeto, numa pasta temporária: a chave fica em `os_crypt.encrypted_key` como base64 de `DPAPI` + blob do DPAPI, e cada segredo é `v10` + nonce de 12 bytes + AES-256-GCM com a etiqueta de 16 bytes no fim. O teste manual `a_secret_written_by_electron_safe_storage_decrypts` decifra um segredo gravado pelo Electron. Ver [[ADR-032 Migração para Tauri e Rust]].
- **A chave é do usuário Windows.** O DPAPI só abre a chave para o mesmo usuário na mesma máquina, como na [[ADR-002 Segredos protegidos pelo DPAPI]].
- **`Local State` existente nunca é substituído.** Se o arquivo existe com a chave, ela só é lida. Se existe sem a chave, ela é acrescentada e os outros campos ficam. Se o arquivo não abre como JSON, nada é escrito e a criptografia fica indisponível ("Windows encryption is not available"). Trocar a chave tornaria ilegível tudo o que o Electron gravou.
- **Gravação atômica.** A chave nova vai para um temporário na mesma pasta e é renomeada.
- **Decifrar não cria chave.** Sem chave no `Local State`, decifrar falha e nada é escrito. Só cifrar cria a chave.
- **Nonce novo a cada segredo**, gerado pelo sistema.
- **Segredo sem `v10` cai no DPAPI direto**, como no Chromium, para blobs antigos.
- **Mensagem de erro fixa.** Uma falha ao decifrar devolve o mesmo texto do Electron, sem bytes do segredo.

## Testes

`src-tauri/tests/platform/windows/safe_storage.rs`: a primeira cifra cria a chave protegida pelo DPAPI real e uma segunda instância decifra; nonces diferentes; um segredo montado à mão no formato do Chromium com chave conhecida; campos do `Local State` preservados; `Local State` ilegível não sobrescrito; segredo adulterado ou sem chave recusado sem criar arquivo; segredo DPAPI sem prefixo.

O teste ignorado precisa de uma amostra do Electron: rode `ECLIPSE_SAFE_STORAGE_SAMPLE=<pasta> cargo test --test platform -- --ignored`, com `<pasta>/blob.b64` e `<pasta>/ud/Local State` gerados pelo `safeStorage` numa pasta de dados temporária. Nunca aponte para a pasta de dados real.

## Pontos de atenção

- O Chromium pode mudar o formato (`v10`). Enquanto os dois apps conviverem, um Electron atualizado precisa continuar gravando `v10`; o teste manual mostra se mudou.
