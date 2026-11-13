use std::sync::OnceLock;

use regex::Regex;

pub const LANGUAGES: [&str; 2] = ["pt", "en"];
pub const DEFAULT_LANGUAGE: &str = "pt";

pub const MESSAGES: &[(&str, &str)] = &[
    ("Sign-in cancelled", "Login cancelado"),
    ("Sign-in failed", "O login falhou"),
    ("Preparing sign-in…", "Preparando o login…"),
    ("Preparing the Riot Client sign-in…", "Preparando o login no Riot Client…"),
    ("Signing in…", "Entrando na conta…"),
    ("Closing Riot Client in the background…", "Fechando o Riot Client em segundo plano…"),
    ("Starting Riot services in the background…", "Iniciando os serviços da Riot em segundo plano…"),
    ("Signing in with the saved session…", "Entrando com a sessão salva…"),
    ("Signing in in the background…", "Entrando em segundo plano…"),
    ("Signed in. Preparing the game…", "Conta conectada. Preparando o jogo…"),
    ("Starting VALORANT in the background…", "Abrindo o VALORANT em segundo plano…"),
    ("Starting League of Legends in the background…", "Abrindo o League of Legends em segundo plano…"),
    ("Waiting for the VALORANT update to finish…", "Aguardando a atualização do VALORANT terminar…"),
    ("Waiting for the League of Legends update to finish…", "Aguardando a atualização do League of Legends terminar…"),
    ("Game opened", "Jogo aberto"),
    ("Riot Client opened", "Riot Client aberto"),
    ("Riot needs your 2FA code. Enter it in the Riot window", "A Riot pede seu código de 2FA. Digite-o na tela da Riot"),
    ("Riot needs a security check. Complete it in the Riot window", "A Riot pede uma verificação de segurança. Conclua-a na tela da Riot"),
    ("Sign-in is taking longer. Check the Riot window in case it needs you", "O login está demorando. Confira a tela da Riot caso ela precise de você"),
    ("The game is taking longer to open or is updating. Check the Riot Client", "O jogo está demorando para abrir ou está atualizando. Confira o Riot Client"),
    ("Sign-in timed out waiting for your attention. Complete the pending step in Riot Client, then try Play again", "O login expirou esperando sua ação. Conclua a etapa pendente no Riot Client e tente Jogar de novo"),
    ("Sign-in timed out. Open the Riot Client to see what happened", "O login expirou. Abra o Riot Client para ver o que aconteceu"),
    ("Wrong username or password", "Usuário ou senha incorretos"),
    ("Too many attempts, wait a few minutes", "Muitas tentativas, aguarde alguns minutos"),
    ("Riot security check timed out. Open the Riot Client to continue", "A verificação de segurança da Riot expirou. Abra o Riot Client para continuar"),
    ("Riot could not complete sign-in. Open Riot Client to continue", "A Riot não conseguiu concluir o login. Abra o Riot Client para continuar"),
    ("Riot could not initialize sign-in. Open Riot Client to continue", "A Riot não conseguiu iniciar o login. Abra o Riot Client para continuar"),
    ("Riot could not confirm the sign-in session. Open Riot Client to continue", "A Riot não conseguiu confirmar a sessão. Abra o Riot Client para continuar"),
    ("Riot needs your attention. Open Riot Client to continue", "A Riot precisa da sua atenção. Abra o Riot Client para continuar"),
    ("The signed-in Riot ID does not match the selected account. Check the Riot ID saved in this app", "O Riot ID conectado não é o da conta escolhida. Confira o Riot ID salvo no Eclipse"),
    ("Could not verify the signed-in account", "Não foi possível confirmar a conta conectada"),
    ("Could not sign out the previous account", "Não foi possível sair da conta anterior"),
    ("The game update did not finish in time. Open Riot Client to check the update", "A atualização do jogo não terminou a tempo. Abra o Riot Client para conferir"),
    ("The game did not open. Open the Riot Client to check updates or the installation", "O jogo não abriu. Abra o Riot Client para conferir atualizações ou a instalação"),
    ("The game did not open. Open the Riot Client to see what happened", "O jogo não abriu. Abra o Riot Client para ver o que aconteceu"),
    ("The Riot Client did not finish signing in. Open it to see what happened", "O Riot Client não terminou de entrar na conta. Abra-o para ver o que aconteceu"),
    ("The Riot Client did not start. Open it to see what happened", "O Riot Client não iniciou. Abra-o para ver o que aconteceu"),
    ("The Riot Client did not start", "O Riot Client não iniciou"),
    ("The Riot Client window did not open", "A janela do Riot Client não abriu"),
    ("The Riot Client sign-in screen did not load. Finish signing in there", "A tela de login do Riot Client não carregou. Termine o login por lá"),
    ("The Riot Client sign-in form did not respond", "O formulário de login do Riot Client não respondeu"),
    ("The Riot background sign-in service returned an invalid response", "O serviço de login da Riot devolveu uma resposta inválida"),
    ("The Riot authentication service returned an invalid response", "O serviço de autenticação da Riot devolveu uma resposta inválida"),
    ("The local Riot service could not complete the request", "O serviço local da Riot não concluiu o pedido"),
    ("Could not contact the Riot authentication service", "Não foi possível falar com o serviço de autenticação da Riot"),
    ("Could not start the Riot Client. Check its path and Windows permissions", "Não foi possível iniciar o Riot Client. Confira o caminho e as permissões do Windows"),
    ("Could not restart the Riot Client with its interface", "Não foi possível reabrir o Riot Client com a interface"),
    ("Could not close the Riot Client", "Não foi possível fechar o Riot Client"),
    ("Could not update the Riot Client settings file", "Não foi possível atualizar o arquivo de configurações do Riot Client"),
    ("Could not check running Riot games. No accounts were switched", "Não foi possível verificar os jogos abertos. Nenhuma conta foi trocada"),
    ("Riot Client not found. Set its path in Settings", "Riot Client não encontrado. Informe o caminho nas Configurações"),
    ("Account not found", "Conta não encontrada"),
    ("Add the username and password first", "Adicione o usuário e a senha primeiro"),
    ("Account credentials changed. Start sign-in again", "Os dados da conta mudaram. Comece o login de novo"),
    ("A sign-in is already in progress", "Já há um login em andamento"),
    ("Could not keep the session of the account that was signed in. Try Play again", "Não foi possível guardar a sessão da conta que estava conectada. Tente Jogar de novo"),
    ("Select a supported game", "Escolha um jogo compatível"),
    ("The background window guard is shutting down", "O monitor de janelas em segundo plano está sendo encerrado"),
    ("Windows encryption is not available", "A criptografia do Windows não está disponível"),
    ("The game is opening. Wait or cancel from the tray.", "O jogo está sendo aberto. Aguarde ou cancele pela bandeja."),
    ("Riot Client not found. Install the official client before starting Eclipse.", "Riot Client não encontrado. Instale o cliente oficial antes de iniciar o gerenciador."),
    ("Could not follow the Riot window. Restart Eclipse.", "Não foi possível acompanhar a janela do Riot. Reinicie o gerenciador."),
    ("Could not open the accounts in Riot.", "Não foi possível abrir as contas no Riot."),
    ("Could not update ranks. Check the API keys in Settings", "Não foi possível atualizar os elos. Confira as chaves de API nas Configurações"),
];

const PATTERNS: &[(&str, &str, &str, &str)] = &[
    ("^Riot sign-in error: (.+)$", "^Erro de login da Riot: (.+)$", "Riot sign-in error: ", "Erro de login da Riot: "),
    ("^Riot Client window script failed: (.+)$", "^O script da janela do Riot Client falhou: (.+)$", "Riot Client window script failed: ", "O script da janela do Riot Client falhou: "),
];

pub struct MainText {
    pub tray_accounts: &'static str,
    pub tray_open_riot: &'static str,
    pub tray_cancel: &'static str,
    pub tray_start_with_windows: &'static str,
    pub tray_quit: &'static str,
    pub game_failed: &'static str,
    pub needs_attention: &'static str,
    pub open_failed: &'static str,
    pub open_failed_detail: &'static str,
    pub understood: &'static str,
}

const MAIN_TEXT_PT: MainText = MainText {
    tray_accounts: "Contas no Riot",
    tray_open_riot: "Abrir Riot Client",
    tray_cancel: "Cancelar login",
    tray_start_with_windows: "Iniciar com o Windows",
    tray_quit: "Sair",
    game_failed: "Não foi possível abrir o jogo",
    needs_attention: "O login precisa de sua atenção",
    open_failed: "Não foi possível abrir as contas no Riot.",
    open_failed_detail: "Tente de novo pelo ícone da bandeja. Se continuar, confira se o Riot Client está instalado.",
    understood: "Entendi",
};

const MAIN_TEXT_EN: MainText = MainText {
    tray_accounts: "Accounts in Riot",
    tray_open_riot: "Open Riot Client",
    tray_cancel: "Cancel sign-in",
    tray_start_with_windows: "Start with Windows",
    tray_quit: "Quit",
    game_failed: "Could not open the game",
    needs_attention: "The sign-in needs your attention",
    open_failed: "Could not open the accounts in Riot.",
    open_failed_detail: "Try again from the tray icon. If it keeps failing, check that Riot Client is installed.",
    understood: "OK",
};

fn patterns() -> &'static Vec<(Regex, Regex, &'static str, &'static str)> {
    static COMPILED: OnceLock<Vec<(Regex, Regex, &'static str, &'static str)>> = OnceLock::new();
    COMPILED.get_or_init(|| {
        PATTERNS
            .iter()
            .map(|(english, portuguese, en_prefix, pt_prefix)| (Regex::new(english).unwrap(), Regex::new(portuguese).unwrap(), *en_prefix, *pt_prefix))
            .collect()
    })
}

pub fn normalize_language(value: Option<&str>) -> &'static str {
    match value {
        Some("en") => "en",
        _ => DEFAULT_LANGUAGE,
    }
}

pub fn localize(text: &str, language: Option<&str>) -> String {
    let english = normalize_language(language) == "en";
    if let Some((en, pt)) = MESSAGES.iter().find(|(en, pt)| *en == text || *pt == text) {
        return if english { en } else { pt }.to_string();
    }
    for (en_pattern, pt_pattern, en_prefix, pt_prefix) in patterns() {
        let captured = en_pattern.captures(text).or_else(|| pt_pattern.captures(text));
        if let Some(code) = captured.and_then(|found| found.get(1)) {
            return format!("{}{}", if english { en_prefix } else { pt_prefix }, code.as_str());
        }
    }
    text.to_string()
}

pub fn main_text(language: Option<&str>) -> &'static MainText {
    if normalize_language(language) == "en" {
        &MAIN_TEXT_EN
    } else {
        &MAIN_TEXT_PT
    }
}
