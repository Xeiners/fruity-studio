// Empeche l'ouverture d'une console supplementaire sous Windows en release. NE PAS SUPPRIMER.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    fruity_studio_lib::run()
}
