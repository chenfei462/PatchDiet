import { original as renamed } from "./helpers";
import "./side-effect";
import * as bundle from "./bundle";

export function run() {
  return renamed("x") + bundle.total;
}
