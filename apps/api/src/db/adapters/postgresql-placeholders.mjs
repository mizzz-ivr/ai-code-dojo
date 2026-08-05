import { assertSql } from './database-client-contract.mjs';

export const toPostgresqlPlaceholders = (sql) => {
  assertSql(sql);

  let index = 0;
  let inSingleQuote = false;
  let output = '';

  for (let cursor = 0; cursor < sql.length; cursor += 1) {
    const character = sql[cursor];
    const nextCharacter = sql[cursor + 1];

    if (character === "'" && inSingleQuote && nextCharacter === "'") {
      output += "''";
      cursor += 1;
      continue;
    }

    if (character === "'") {
      inSingleQuote = !inSingleQuote;
      output += character;
      continue;
    }

    if (character === '?' && !inSingleQuote) {
      index += 1;
      output += `$${index}`;
      continue;
    }

    output += character;
  }

  if (inSingleQuote) {
    throw new SyntaxError('sql contains an unterminated single-quoted string.');
  }

  return output;
};
