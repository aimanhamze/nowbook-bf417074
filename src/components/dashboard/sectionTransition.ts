/**
 * The open / back transition of a dashboard section: the content fades in
 * and rises 8px. Used by the dashboard itself (hub ↔ section), the academy
 * course screen (list ↔ course) and the /instructors pages, so every provider
 * screen opens the same way. Reduced motion keeps only the fade.
 *
 * Spread onto a KEYED motion element; the key changing is what replays it, in
 * both directions (open and back look the same).
 */
export function sectionTransition(reduceMotion: boolean) {
  return {
    initial: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 },
    animate: reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 },
    transition: { duration: 0.25 },
  };
}
