
import {MailProcessor} from '../../static/MailProcessor.js';
import {ServerStorage} from '../../static/ServerStorage.js';
import {Settings} from '../../static/Settings.js';

test('FIXME', () => {
  const mockSettings = new Settings(new ServerStorage());
  const mailProcessor = new MailProcessor(mockSettings);
  expect(mailProcessor).toBeDefined();
});
