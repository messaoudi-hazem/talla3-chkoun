sed -i 's/gameLogic.setSecretCharacter(roomId, user!.uid, secretCharacterInput)/gameLogic.setSecretWord(roomId, user!.uid, secretWordInput)/g' src/App.tsx
sed -i 's/handleSetSecretCharacter/handleSetSecretWord/g' src/App.tsx
sed -i 's/const res = await gameLogic.submitGuess(roomId, currentPlayer, targetPlayer, guessInput, players);/const res = await gameLogic.submitGuess(roomId, currentPlayer, targetPlayer, guessInput, players, room);/g' src/App.tsx
