/** AST for the Python subset. Every node carries a line for error reporting. */

export interface Node { line: number }

export type Expr =
  | ({ type: 'Num'; value: number } & Node)
  | ({ type: 'Str'; value: string } & Node)
  | ({ type: 'FStr'; raw: string } & Node)
  | ({ type: 'Bool'; value: boolean } & Node)
  | ({ type: 'None' } & Node)
  | ({ type: 'Name'; id: string } & Node)
  | ({ type: 'List'; items: Expr[] } & Node)
  | ({ type: 'Tuple'; items: Expr[] } & Node)
  | ({ type: 'Dict'; entries: { key: Expr; value: Expr }[] } & Node)
  | ({ type: 'Unary'; op: '-' | '+' | 'not'; operand: Expr } & Node)
  | ({ type: 'BinOp'; op: BinaryOp; left: Expr; right: Expr } & Node)
  | ({ type: 'Compare'; op: CompareOp; left: Expr; right: Expr } & Node)
  | ({ type: 'BoolOp'; op: 'and' | 'or'; left: Expr; right: Expr } & Node)
  | ({ type: 'Call'; callee: Expr; args: Expr[]; kwargs: { name: string; value: Expr }[] } & Node)
  | ({ type: 'Attribute'; object: Expr; name: string } & Node)
  | ({ type: 'Index'; object: Expr; index: Expr } & Node)
  | ({ type: 'Slice'; object: Expr; start: Expr | null; stop: Expr | null; step: Expr | null } & Node)
  | ({ type: 'Comp'; element: Expr; target: string; iter: Expr; condition: Expr | null } & Node)
  | ({ type: 'Ternary'; whenTrue: Expr; condition: Expr; whenFalse: Expr } & Node);

export type BinaryOp = '+' | '-' | '*' | '/' | '//' | '%' | '**';
export type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not in' | 'is' | 'is not';

export type AssignTarget =
  | ({ type: 'NameTarget'; id: string } & Node)
  | ({ type: 'IndexTarget'; object: Expr; index: Expr } & Node);

export type Stmt =
  | ({ type: 'ExprStmt'; value: Expr } & Node)
  | ({ type: 'Assign'; targets: AssignTarget[]; value: Expr } & Node)
  | ({ type: 'AugAssign'; target: AssignTarget; op: BinaryOp; value: Expr } & Node)
  | ({ type: 'If'; branches: { condition: Expr | null; body: Stmt[] }[] } & Node)
  | ({ type: 'While'; condition: Expr; body: Stmt[] } & Node)
  | ({ type: 'For'; targets: string[]; iter: Expr; body: Stmt[] } & Node)
  | ({ type: 'FuncDef'; name: string; params: { name: string; default: Expr | null }[]; body: Stmt[] } & Node)
  | ({ type: 'Return'; value: Expr | null } & Node)
  | ({ type: 'Break' } & Node)
  | ({ type: 'Continue' } & Node)
  | ({ type: 'Pass' } & Node);

export interface Program { body: Stmt[] }
