import { AnimatePresence, motion } from 'framer-motion';
import Cookies from 'js-cookie';
import { useCallback, useState } from 'react';
import { toast } from 'react-toastify';
import { useGit } from '~/lib/hooks/useGit';
import type { ActionAlert } from '~/types/actions';
import { classNames } from '~/utils/classNames';

interface Props {
  alert: ActionAlert;
  clearAlert: () => void;
  postMessage: (message: string) => void;
}

export default function ChatAlert({ alert, clearAlert, postMessage }: Props) {
  const { description, content, source } = alert;

  const [isReporting, setIsReporting] = useState(false);

  const { gitReportIssue } = useGit();

  const isPreview = source === 'preview';
  const title = isPreview ? 'Preview Error' : 'Terminal Error';
  const message = isPreview
    ? 'We encountered an error while running the preview. Would you like Webrunch to analyze and help resolve this issue?'
    : 'We encountered an error while running terminal commands. Would you like Webrunch to analyze and help resolve this issue?';

  const handleReportIssue = useCallback(async () => {
    const getCredentials = (): { username: string; token: string } | null => {
      const githubUsername = Cookies.get('githubUsername');
      const githubToken = Cookies.get('githubToken');

      if (githubUsername && githubToken) {
        return { username: githubUsername, token: githubToken };
      }

      const username = prompt('Please enter your GitHub username:') || '';
      const token = prompt('Please enter your GitHub personal access token:') || '';

      if (!username || !token) {
        window.alert('GitHub username and token are required. Report issue cancelled.');
        return null;
      }

      return { username, token };
    };

    const getIssueTitle = (): string => {
      return prompt('Please enter your issue title:') || 'Issue';
    };

    try {
      setIsReporting(true); // Start loading immediately

      const credentials = getCredentials();

      if (!credentials) {
        return;
      }

      const issueTitle = getIssueTitle();

      const issueContent = `*Fix this ${isPreview ? 'preview' : 'terminal'} error* \n\`\`\`${isPreview ? 'js' : 'sh'}\n${content}\n\`\`\`\n`;

      const repoName = prompt('Please enter a name for your new GitHub repository:');

      if (!repoName) {
        window.alert('Repository name is required. Push to GitHub cancelled.');
        return;
      }

      await gitReportIssue(repoName, issueTitle, credentials.username, credentials.token, issueContent);
    } catch (error) {
      console.error('Error reporting to GitHub:', error);
      toast.error('Failed to report issue. Check the console for more details.');
    } finally {
      setIsReporting(false); // Stop loading
    }
  }, [setIsReporting, isPreview, content]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className={`rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4`}
      >
        <div className="flex items-start">
          {/* Icon */}
          <motion.div
            className="flex-shrink-0"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2 }}
          >
            <div className={`i-ph:warning-duotone text-xl text-bolt-elements-button-danger-text`}></div>
          </motion.div>
          {/* Content */}
          <div className="ml-3 flex-1">
            <motion.h3
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
              className={`text-sm font-medium text-bolt-elements-textPrimary`}
            >
              {title}
            </motion.h3>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className={`mt-2 text-sm text-bolt-elements-textSecondary`}
            >
              <p>{message}</p>
              {description && (
                <div className="text-xs text-bolt-elements-textSecondary p-2 bg-bolt-elements-background-depth-3 rounded mt-4 mb-4">
                  Error: {description}
                </div>
              )}
            </motion.div>

            {/* Actions */}
            <motion.div
              className="mt-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <div className={classNames(' flex gap-2')}>
                <button
                  onClick={() =>
                    postMessage(
                      `*Fix this ${isPreview ? 'preview' : 'terminal'} error* \n\`\`\`${isPreview ? 'js' : 'sh'}\n${content}\n\`\`\`\n`,
                    )
                  }
                  className={classNames(
                    `px-2 py-1.5 rounded-md text-sm font-medium`,
                    'bg-bolt-elements-button-primary-background',
                    'hover:bg-bolt-elements-button-primary-backgroundHover',
                    'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-bolt-elements-button-danger-background',
                    'text-bolt-elements-button-primary-text',
                    'flex items-center gap-1.5',
                  )}
                >
                  <div className="i-ph:chat-circle-duotone"></div>
                  Ask Webrunch
                </button>

                <button
                  disabled={isReporting}
                  onClick={handleReportIssue}
                  className={classNames(
                    `px-2 py-1.5 rounded-md text-sm font-medium`,
                    'bg-bolt-elements-button-danger-background',
                    'hover:bg-bolt-elements-button-danger-backgroundHover',
                    'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-bolt-elements-button-danger-background',
                    'text-bolt-elements-button-danger-text',
                    'flex items-center gap-1.5',
                  )}
                >
                  {isReporting ? <div className="i-ph:spinner" /> : <div className="i-ph:bug-duotone" />}

                  {isReporting ? 'Reporting...' : 'Report'}
                </button>

                <button
                  onClick={clearAlert}
                  className={classNames(
                    `px-2 py-1.5 rounded-md text-sm font-medium`,
                    'bg-bolt-elements-button-secondary-background',
                    'hover:bg-bolt-elements-button-secondary-backgroundHover',
                    'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-bolt-elements-button-secondary-background',
                    'text-bolt-elements-button-secondary-text',
                  )}
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
