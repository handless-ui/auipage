export default function (options) {
    return {
        description: {
            type: "function",
            function: {
                name: options.name,
                description: options.description,
                parameters: options.parameters
            }
        },
        execute: options.execute,
        render: options.render
    };
};