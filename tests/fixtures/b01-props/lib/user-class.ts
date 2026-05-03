export class UserClass {
  constructor(public name: string) {}
  greet(): string {
    return `hi ${this.name}`;
  }
}
