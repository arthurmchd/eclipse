use eclipse::platform::windows::window_guard::{activation_candidate, activation_score, client_interface, game_process, game_processes, NativeWindows, WindowOps, GAMES};

#[test]
fn only_root_riot_interface_windows_of_a_real_size_can_be_brought_to_the_front() {
    assert!(activation_candidate("Riot Client", "Chrome_WidgetWin_1", 1536, 864, true));
    assert!(activation_candidate("RiotClientUx", "Chrome_WidgetWin_1", 1536, 864, true));
    assert!(!activation_candidate("RiotClientServices", "TrayIconClass", 400, 430, true));
    assert!(!activation_candidate("Riot Client", "TrayIconClass", 1536, 864, true));
    assert!(!activation_candidate("Riot Client", "IME", 0, 0, true));
    assert!(!activation_candidate("Riot Client", "Chrome_WidgetWin_1", 319, 864, true));
    assert!(!activation_candidate("Riot Client", "Chrome_WidgetWin_1", 1536, 239, true));
    assert!(!activation_candidate("RiotClientServices", "Chrome_WidgetWin_1", 1536, 864, true));
    assert!(!activation_candidate("LeagueClientUx", "Chrome_WidgetWin_1", 1536, 864, true));
    assert!(!activation_candidate("Riot Client", "Chrome_WidgetWin_1", 1536, 864, false));
}

#[test]
fn the_riot_interface_is_only_its_two_processes() {
    assert!(client_interface("riot client"));
    assert!(client_interface("RiotClientUx"));
    for other in ["RiotClientUxRender", "RiotClientServices", "LeagueClientUx", "VALORANT", ""] {
        assert!(!client_interface(other), "{other}");
    }
}

#[test]
fn the_window_titled_riot_client_wins_over_a_bigger_one() {
    assert!(activation_score(800, 600, "Riot Client") > activation_score(3840, 2160, "Other"));
    assert!(activation_score(1600, 900, "") > activation_score(800, 600, ""));
}

#[test]
fn each_game_only_matches_its_own_processes() {
    assert!(game_process("lol", "LeagueClientUx"));
    assert!(game_process("lol", "league of legends"));
    assert!(game_process("tft", "TFTClient-Win64-Shipping"));
    assert!(game_process("val", "VALORANT-Win64-Shipping"));
    assert!(game_process("2xko", "Lion-Win64-Shipping"));
    assert!(game_process("lor", "LoR"));
    for (game, other) in [("lol", "VALORANT"), ("val", "LeagueClientUx"), ("lol", "Riot Client"), ("tft", "League of Legends"), ("lor", "Lion"), ("2xko", "LoR")] {
        assert!(!game_process(game, other), "{game} {other}");
    }
    assert_eq!(GAMES, ["lol", "tft", "val", "2xko", "lor"]);
    assert_eq!(game_processes("lol"), ["LeagueClientUx", "League of Legends"]);
}

#[test]
fn the_native_helper_refuses_an_unknown_game_before_looking_at_any_window() {
    for game in ["lol\nreveal", "reveal", "", "riot"] {
        assert_eq!(NativeWindows.game_window(game), Err("invalid-game"), "{game}");
    }
}
