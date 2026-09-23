import { EnhancedTrelloCard } from '../trello/types.js';

/** A card as readable markdown, for get_card with includeMarkdown. */
export function formatCardAsMarkdown(card: EnhancedTrelloCard): string {
  let markdown = '';

  // Title and basic info
  markdown += `# ${card.name}\n\n`;

  // Board and List context
  if (card.board && card.list) {
    markdown += `**Board**: [${card.board.name}](${card.board.url}) > **List**: ${card.list.name}\n\n`;
  }

  // Labels
  if (card.labels && card.labels.length > 0) {
    markdown += `## Labels\n`;
    card.labels.forEach(label => {
      markdown += `- \`${label.color}\` ${label.name || '(no name)'}\n`;
    });
    markdown += '\n';
  }

  // Due date
  if (card.due) {
    const dueDate = new Date(card.due);
    const status = card.dueComplete ? 'Complete' : 'Due';
    markdown += `## Due Date\n${status}: ${dueDate.toLocaleString()}\n\n`;
  }

  // Members
  if (card.members && card.members.length > 0) {
    markdown += `## Members\n`;
    card.members.forEach(member => {
      markdown += `- @${member.username} (${member.fullName})\n`;
    });
    markdown += '\n';
  }

  // Description
  if (card.desc) {
    markdown += `## Description\n`;
    markdown += `${card.desc}\n\n`;

    // Parse for inline images (Trello uses markdown-like syntax)
    // Look for patterns like ![alt text](image url)
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const images = card.desc.match(imageRegex);
    if (images) {
      markdown += `### Inline Images in Description\n`;
      images.forEach((img, index) => {
        const match = img.match(/!\[([^\]]*)\]\(([^)]+)\)/);
        if (match) {
          markdown += `${index + 1}. ${match[1] || 'Image'}: ${match[2]}\n`;
        }
      });
      markdown += '\n';
    }
  }

  // Checklists
  if (card.checklists && card.checklists.length > 0) {
    markdown += `## Checklists\n`;
    card.checklists.forEach(checklist => {
      const completed = checklist.checkItems.filter(item => item.state === 'complete').length;
      const total = checklist.checkItems.length;
      markdown += `### ${checklist.name} (${completed}/${total})\n`;

      // Sort by position
      const sortedItems = [...checklist.checkItems].sort((a, b) => a.pos - b.pos);

      sortedItems.forEach(item => {
        const checkbox = item.state === 'complete' ? '[x]' : '[ ]';
        markdown += `- ${checkbox} ${item.name}`;
        if (item.due) {
          const itemDue = new Date(item.due);
          markdown += ` (Due: ${itemDue.toLocaleDateString()})`;
        }
        if (item.idMember) {
          const member = card.members?.find(m => m.id === item.idMember);
          if (member) {
            markdown += ` - @${member.username}`;
          }
        }
        markdown += '\n';
      });
      markdown += '\n';
    });
  }

  // Attachments
  if (card.attachments && card.attachments.length > 0) {
    markdown += `## Attachments (${card.attachments.length})\n`;
    card.attachments.forEach((attachment, index) => {
      markdown += `### ${index + 1}. ${attachment.name}\n`;
      markdown += `- **URL**: ${attachment.url}\n`;
      if (attachment.fileName) {
        markdown += `- **File**: ${attachment.fileName}`;
        if (attachment.bytes) {
          const size = formatFileSize(attachment.bytes);
          markdown += ` (${size})`;
        }
        markdown += '\n';
      }
      if (attachment.mimeType) {
        markdown += `- **Type**: ${attachment.mimeType}\n`;
      }
      markdown += `- **Added**: ${new Date(attachment.date).toLocaleString()}\n`;

      // Image preview
      if (attachment.previews && attachment.previews.length > 0) {
        const preview = attachment.previews[0];
        markdown += `- **Preview**: ![${attachment.name}](${preview.url})\n`;
      }
      markdown += '\n';
    });
  }

  // Comments
  if (card.actions && card.actions.length > 0) {
    markdown += `## Comments (${card.actions.length})\n`;
    card.actions.forEach(comment => {
      const date = new Date(comment.date);
      markdown += `### ${comment.memberCreator.fullName} (@${comment.memberCreator.username}) - ${date.toLocaleString()}\n`;
      markdown += `${comment.data.text}\n\n`;
    });
  }

  // Statistics
  if (card.badges) {
    markdown += `## Statistics\n`;
    if (card.badges.checkItems > 0) {
      markdown += `- **Checklist Items**: ${card.badges.checkItemsChecked}/${card.badges.checkItems} completed\n`;
    }
    if (card.badges.comments > 0) {
      markdown += `- **Comments**: ${card.badges.comments}\n`;
    }
    if (card.badges.attachments > 0) {
      markdown += `- **Attachments**: ${card.badges.attachments}\n`;
    }
    if (card.badges.votes > 0) {
      markdown += `- **Votes**: ${card.badges.votes}\n`;
    }
    markdown += '\n';
  }

  // Links
  markdown += `## Links\n`;
  markdown += `- **Card URL**: ${card.url}\n`;
  markdown += `- **Short URL**: ${card.shortUrl}\n\n`;

  // Metadata
  markdown += `---\n`;
  markdown += `*Last Activity: ${new Date(card.dateLastActivity).toLocaleString()}*\n`;
  markdown += `*Card ID: ${card.id}*\n`;

  return markdown;
}

function formatFileSize(bytes: number): string {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
}
