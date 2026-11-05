import { helper } from "./helper";

@component()
export class Greeter {
  greet() {
    const shout = function shout() { return "!"; };
    return helper(shout());
  }
}
