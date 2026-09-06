export const logo = (append) => {
  console.log('                          _ ');
  console.log(' _ __ ___  _ __  ___  ___| |');
  console.log("| '__/ _ \\| '_ \\/ __|/ _ \\ |");
  console.log('| | | (_) | | | \\__ \\  __/ |');
  console.log(`|_|  \\___/|_| |_|___/\\___|_| ${append}`);
};

/**
 * It's important that anyone gets used to use this tool on a daily basis,
 * as it's meant to save time.
 * 
 * this function makes it more enternained for everyone.
 * 
 * @returns 
 */
export const wisdom = () => {
  // Multiline string variable
  const multilineString = `(maybe) Linus Torvalds: "Good tools improve the way you work. Great tools improve the way you think about solving problems."
(maybe) Steve Jobs: "The best tools don’t just make your job easier; they empower you to achieve things you couldn't before."
(maybe) Martin Fowler: "Tools are not just about making tasks easier; they are about enabling you to work smarter and deliver higher-quality software."
(maybe) Kent Beck: "Using the right tools doesn’t just speed up development—it enhances your ability to produce clean, reliable code."
(maybe) Jeff Atwood: "Great developers use the best tools available to them because they know that good tools amplify their productivity and code quality."
(maybe) Brian Kernighan: "The right development tools can make complex problems manageable and turn challenging projects into achievable goals."
(maybe) Bill Gates: "The right tool can transform how you work and how effectively you solve problems. Choose wisely."
(maybe) Robert C. Martin (Uncle Bob): "Effective developers use tools not just for efficiency but to ensure they are writing the best possible code."
(maybe) David Heinemeier Hansson: "Investing time in choosing the right tools pays off in cleaner, more maintainable code and smoother development processes."
(maybe) Sandi Metz: "Good tools allow you to focus on solving problems, not battling with limitations."
(maybe) Michael Feathers: "Good tools help you to navigate complexity, not just manage it."
(maybe) Søren Kierkegaard: "The greatest task of the developer is to know when and how to use the right tools for the job."
(maybe) Grady Booch: "Tools do not replace thinking but amplify our ability to think."
(maybe) Eric Raymond: "The best software tools are those that help you understand and solve problems better."
(maybe) Dan North: "Choosing the right tool is as crucial as writing the right code. Both shape the quality of the final product."
(maybe) James A. Whittaker: "The right tool makes a complex task seem simple and a difficult challenge seem achievable."
(maybe) Ward Cunningham: "Good tools are not just conveniences; they are essential to successful and efficient software development."
(maybe) Ron Jeffries: "The quality of your code is only as good as the quality of your tools."
(maybe) Jez Humble: "The best tools for software development are those that fit seamlessly into your workflow and enhance productivity."
(maybe) Paul Graham: "A tool that doesn’t fit your workflow is like a shoe that doesn’t fit your foot. Find the one that works for you."`;
  // Function to pick a random line from a multiline string
  const pickRandomLine = () => {
    // Split the multiline string into an array of lines
    const lines = multilineString.trim().split('\n');
    // Select a random line
    const randomLine = lines[Math.floor(Math.random() * lines.length)];
    // Print the selected random line
    return randomLine;
  };
  // Use the function
  const quote = pickRandomLine();
  console.log(`   ${quote}`);
  console.log('   ');
  console.log('   ');
  console.log('   ');
};

const isInteractive = process.stdout.isTTY;
export { isInteractive };
