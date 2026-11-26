// Applique le theme memorise avant le premier rendu React (evite un flash clair/sombre).
(function () {
  var pref = "dark";
  try {
    pref = window.localStorage.getItem("fruity-theme") || "dark";
  } catch (e) {
    /* stockage indisponible : theme sombre par defaut */
  }
  var dark =
    pref === "dark" ||
    (pref === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
})();
