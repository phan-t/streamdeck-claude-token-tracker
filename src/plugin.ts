import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { Usage } from "./actions/usage";

streamDeck.logger.setLevel(LogLevel.INFO);

streamDeck.actions.registerAction(new Usage());

streamDeck.connect();
