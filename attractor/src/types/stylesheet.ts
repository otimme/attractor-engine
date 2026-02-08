export interface Selector {
  kind: "universal" | "shape" | "class" | "id";
  value: string; // "*" for universal, shape name, class name, or node id
  specificity: number; // 0=universal, 0.5=shape, 1=class, 2=id
}

export interface Declaration {
  property: string;
  value: string;
}

export interface StylesheetRule {
  selector: Selector;
  declarations: Declaration[];
}
