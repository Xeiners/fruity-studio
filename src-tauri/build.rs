fn main() {
    // Sans cela, remplacer un fichier d'icone ne met pas a jour l'icone de l'executable.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
